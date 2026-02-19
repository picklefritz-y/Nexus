// ============================================================
// Podcast Ingestion Test Script
// Usage: npx tsx scripts/ingest-podcast.ts "YOUTUBE_URL"
// ============================================================

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY!;
const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MVP_USER_ID = "user_mvp";

// --- Helpers ---

function log(step: string, message: string) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] ${step}`);
  console.log(`  ${message}`);
}

function logDetail(message: string) {
  console.log(`  → ${message}`);
}

// --- Step 1: Download audio with yt-dlp, then transcribe with AssemblyAI ---

async function transcribe(url: string) {
  log("📡 STEP 1: TRANSCRIPTION", `Processing: ${url}`);

  // Download audio with yt-dlp
  const audioDir = path.join(process.cwd(), "audio");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, `podcast-${Date.now()}.m4a`);

  logDetail("Downloading audio with yt-dlp...");
  try {
    execSync(`yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "${audioPath}" --no-playlist "${url}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600000, // 10 minute timeout
    });
  } catch (e: any) {
    throw new Error(`yt-dlp download failed: ${e.message}`);
  }

  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
    throw new Error("yt-dlp produced no audio file");
  }
  const sizeMB = (fs.statSync(audioPath).size / 1048576).toFixed(1);
  logDetail(`✅ Audio downloaded: ${sizeMB} MB`);

  // Upload to AssemblyAI
  logDetail("Uploading audio to AssemblyAI...");
  const audioData = fs.readFileSync(audioPath);
  const uploadResponse = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: {
      Authorization: ASSEMBLYAI_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: audioData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload failed: ${uploadResponse.status}`);
  }
  const { upload_url } = await uploadResponse.json();
  logDetail(`✅ Audio uploaded to AssemblyAI`);

  // Clean up local file
  fs.unlinkSync(audioPath);

  // Submit for transcription
  logDetail("Submitting for transcription...");
  const submitResponse = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: {
      Authorization: ASSEMBLYAI_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: ["universal-3-pro"],

      auto_chapters: true,
      speaker_labels: true,
      iab_categories: true,
    }),
  });

  if (!submitResponse.ok) {
    const error = await submitResponse.text();
    throw new Error(`AssemblyAI submit failed: ${submitResponse.status} - ${error}`);
  }

  const { id } = await submitResponse.json();
  logDetail(`Job submitted: ${id}`);
  logDetail("Polling for completion (this takes a few minutes for longer episodes)...");

  // Poll for completion
  let dots = 0;
  while (true) {
    const pollResponse = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { Authorization: ASSEMBLYAI_KEY },
    });
    const data = await pollResponse.json();

    if (data.status === "completed") {
      const durationMin = Math.round((data.audio_duration || 0) / 60);
      logDetail(`✅ Transcription complete! Duration: ${durationMin} minutes`);
      logDetail(`Text length: ${data.text?.length || 0} characters`);
      logDetail(`Chapters: ${data.chapters?.length || 0}`);
      logDetail(`Speakers detected: ${new Set(data.utterances?.map((u: any) => u.speaker)).size || 0}`);
      return data;
    }

    if (data.status === "error") {
      throw new Error(`Transcription failed: ${data.error}`);
    }

    // Show progress
    dots = (dots + 1) % 4;
    process.stdout.write(`\r  ⏳ Status: ${data.status} ${".".repeat(dots + 1)}${"  ".repeat(3 - dots)}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// --- Step 2: Extract Claims with Claude ---

async function extractClaims(transcript: any) {
  const title = transcript.chapters?.[0]?.headline || "Podcast Episode";
  const chapterSummary = (transcript.chapters || [])
    .map((ch: any, i: number) => `Chapter ${i + 1}: ${ch.headline}\n${ch.summary}`)
    .join("\n\n");

  const textForProcessing = chapterSummary.length > 500
    ? `CHAPTER SUMMARIES:\n${chapterSummary}\n\nFULL TRANSCRIPT (first 40,000 chars):\n${transcript.text?.slice(0, 40000)}`
    : transcript.text?.slice(0, 50000) || "";

  log("🧠 STEP 2: CLAIM EXTRACTION", `Sending ${textForProcessing.length} chars to Claude for analysis...`);

  const prompt = `You are a scientific knowledge extraction system. Analyze the following podcast transcript and extract structured information.

SOURCE TITLE: "${title}"
SOURCE TYPE: PODCAST

CONTENT:
${textForProcessing}

Respond with valid JSON matching this exact structure:
{
  "title": "Best guess at the episode title from the content",
  "author": "The host's name",
  "summary": "A 2-3 paragraph summary of the key points and arguments",
  "keyTakeaways": ["takeaway 1", "takeaway 2"],
  "claims": [
    {
      "text": "A discrete, falsifiable claim stated as a clear assertion",
      "explanation": "2-3 sentence explanation of the evidence behind this claim",
      "implications": "What this means practically",
      "confidence": 0.85,
      "supportingQuote": "Exact quote from the transcript that supports this claim"
    }
  ]
}

EXTRACTION RULES:
- Extract DISCRETE CLAIMS: each should be a single, specific, testable assertion
- NOT summaries or opinions — factual claims that can be verified or contradicted
- Confidence: 0.9+ = strong evidence cited, 0.7-0.9 = study referenced, 0.5-0.7 = expert opinion, 0.3-0.5 = anecdotal
- Aim for 5-15 claims depending on content density
- Include the SUPPORTING QUOTE from the transcript

Return ONLY valid JSON, no markdown formatting or code blocks.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const cleaned = content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const result = JSON.parse(cleaned);

  logDetail(`✅ Extracted: "${result.title}"`);
  logDetail(`Author: ${result.author}`);
  logDetail(`Claims extracted: ${result.claims.length}`);
  result.claims.forEach((c: any, i: number) => {
    logDetail(`  ${i + 1}. [${(c.confidence * 100).toFixed(0)}%] ${c.text.slice(0, 100)}...`);
  });

  return result;
}

// --- Step 3: Detect Themes ---

async function detectThemes(claims: any[], title: string, summary: string) {
  log("🏷️  STEP 3: THEME DETECTION", "Identifying knowledge domains...");

  const existingThemes = await prisma.theme.findMany({ select: { id: true, name: true } });
  const existingNames = existingThemes.map((t) => t.name);

  const prompt = `Given extracted claims and a source summary, identify the relevant knowledge themes/domains.

SOURCE: "${title}"
SUMMARY: ${summary}

CLAIMS:
${claims.map((c: any, i: number) => `${i + 1}. "${c.text}"`).join("\n")}

EXISTING THEMES IN THE SYSTEM:
${existingNames.length > 0 ? existingNames.join(", ") : "(none yet)"}

Respond with valid JSON — an array of theme suggestions:
[
  { "name": "Theme Name", "relevance": 0.95, "isNew": false }
]

RULES:
- PREFER existing themes when content fits
- Only suggest NEW themes if content genuinely doesn't fit existing ones
- Theme names: broad enough for multiple sources, specific enough to be meaningful
- Typically 1-4 themes per source

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const themes = JSON.parse(content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

  themes.forEach((t: any) => {
    const tag = t.isNew ? "🆕" : "📂";
    logDetail(`${tag} ${t.name} (relevance: ${(t.relevance * 100).toFixed(0)}%)`);
  });

  return { themes, existingThemes };
}

// --- Step 4: Detect Contradictions ---

async function detectContradictions(claims: any[]) {
  log("⚡ STEP 4: CONTRADICTION DETECTION", "Comparing against existing claims...");

  const existingClaims = await prisma.claim.findMany({
    include: {
      themes: { include: { theme: true } },
    },
  });

  if (existingClaims.length === 0) {
    logDetail("No existing claims to compare against — skipping.");
    return [];
  }

  logDetail(`Comparing ${claims.length} new claims against ${existingClaims.length} existing claims...`);

  const prompt = `Compare new claims against existing claims to identify contradictions.

NEW CLAIMS:
${claims.map((c: any, i: number) => `NEW-${i + 1}: "${c.text}" (confidence: ${c.confidence})`).join("\n")}

EXISTING CLAIMS:
${existingClaims.map((c) => `[${c.id}] "${c.text}" (status: ${c.status}, confidence: ${c.confidence}, themes: ${c.themes.map((t) => t.theme.name).join(", ")})`).join("\n")}

Respond with valid JSON — an array of detected contradictions (empty array if none):
[
  {
    "newClaimText": "exact text of new claim",
    "existingClaimId": "the_id",
    "existingClaimText": "text of existing claim",
    "explanation": "How these contradict",
    "severity": 0.7,
    "type": "direct_contradiction"
  }
]

Types: direct_contradiction | nuance | supersession | scope_limitation
Only flag GENUINE contradictions about the SAME subject matter. Be conservative.

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const contradictions = JSON.parse(content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

  if (contradictions.length === 0) {
    logDetail("No contradictions detected.");
  } else {
    contradictions.forEach((c: any) => {
      logDetail(`⚡ ${c.type} (severity: ${c.severity}): "${c.newClaimText.slice(0, 60)}..." vs "${c.existingClaimText.slice(0, 60)}..."`);
    });
  }

  return contradictions;
}

// --- Step 5: Store Everything ---

async function storeResults(
  url: string,
  transcript: any,
  extraction: any,
  themeData: any,
  contradictions: any[]
) {
  log("💾 STEP 5: STORING IN DATABASE", "Saving source, claims, themes, and review cards...");

  const durationSeconds = Math.round(transcript.audio_duration || 0);

  // Create source
  const source = await prisma.source.create({
    data: {
      userId: MVP_USER_ID,
      type: "PODCAST",
      status: "COMPLETE",
      title: extraction.title,
      author: extraction.author,
      url: url,
      summary: extraction.summary,
      keyTakeaways: JSON.stringify(extraction.keyTakeaways),
      rawText: transcript.text?.slice(0, 100000), // store first 100k chars
      durationSeconds,
      publicationDate: new Date(),
    },
  });
  logDetail(`Source saved: ${source.id}`);

  // Create/link themes
  const themeMap = new Map<string, string>();
  for (const t of themeData.themes) {
    let themeId: string;
    if (t.isNew) {
      const newTheme = await prisma.theme.create({
        data: {
          name: t.name,
          slug: t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
          isAutoGenerated: true,
        },
      });
      themeId = newTheme.id;
      logDetail(`Created new theme: ${t.name}`);
    } else {
      const existing = themeData.existingThemes.find(
        (et: any) => et.name.toLowerCase() === t.name.toLowerCase()
      );
      if (!existing) continue;
      themeId = existing.id;
    }
    themeMap.set(t.name, themeId);

    await prisma.sourceTheme.create({
      data: { sourceId: source.id, themeId, relevance: t.relevance },
    });
  }

  // Create claims and review cards
  const claimIds: string[] = [];
  for (const c of extraction.claims) {
    const claim = await prisma.claim.create({
      data: {
        text: c.text,
        explanation: c.explanation,
        implications: c.implications,
        confidence: c.confidence,
        status: "EMERGING",
      },
    });
    claimIds.push(claim.id);

    // Link to source
    await prisma.claimSource.create({
      data: {
        claimId: claim.id,
        sourceId: source.id,
        extractedText: c.supportingQuote,
      },
    });

    // Link to themes
    for (const [themeName, themeId] of themeMap) {
      await prisma.claimTheme.create({
        data: { claimId: claim.id, themeId },
      }).catch(() => {}); // ignore duplicates
    }

    // Create FSRS review card
    await prisma.reviewCard.create({
      data: {
        userId: MVP_USER_ID,
        claimId: claim.id,
        due: new Date(),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
      },
    });
  }
  logDetail(`${claimIds.length} claims saved with review cards`);

  // Store contradictions
  let contradictionCount = 0;
  for (const c of contradictions) {
    const newClaim = await prisma.claim.findFirst({
      where: { text: c.newClaimText, id: { in: claimIds } },
    });
    if (newClaim) {
      try {
        await prisma.contradiction.create({
          data: {
            claimId: newClaim.id,
            contradictedId: c.existingClaimId,
            explanation: c.explanation,
            severity: c.severity,
          },
        });
        contradictionCount++;

        if (c.severity > 0.5) {
          await prisma.claim.update({
            where: { id: c.existingClaimId },
            data: { status: "CONTESTED" },
          });
        }
      } catch (e) {
        // ignore if contradiction link fails
      }
    }
  }
  if (contradictionCount > 0) {
    logDetail(`${contradictionCount} contradictions linked`);
  }

  return { sourceId: source.id, claimCount: claimIds.length };
}

// --- Main ---

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log("\n❌ Usage: npx tsx scripts/ingest-podcast.ts \"YOUTUBE_URL\"\n");
    console.log("Example:");
    console.log('  npx tsx scripts/ingest-podcast.ts "https://www.youtube.com/watch?v=..."');
    process.exit(1);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  🔮 NEXUS — Podcast Ingestion Pipeline");
  console.log("═".repeat(60));

  try {
    // Step 1: Transcribe
    const transcript = await transcribe(url);

    // Step 2: Extract claims
    const extraction = await extractClaims(transcript);

    // Step 3: Detect themes
    const themeData = await detectThemes(extraction.claims, extraction.title, extraction.summary);

    // Step 4: Detect contradictions
    const contradictions = await detectContradictions(extraction.claims);

    // Step 5: Store
    const result = await storeResults(url, transcript, extraction, themeData, contradictions);

    // Done!
    console.log("\n" + "═".repeat(60));
    console.log("  ✅ INGESTION COMPLETE");
    console.log("═".repeat(60));
    console.log(`\n  Source ID:     ${result.sourceId}`);
    console.log(`  Claims added:  ${result.claimCount}`);
    console.log(`  Themes:        ${themeData.themes.map((t: any) => t.name).join(", ")}`);
    console.log(`  Contradictions: ${contradictions.length}`);
    console.log(`\n  These claims are now in your review queue! 🎯\n`);

  } catch (error: any) {
    console.error("\n❌ Pipeline error:", error.message);
    if (error.message.includes("AssemblyAI")) {
      console.error("   Check your ASSEMBLYAI_API_KEY in .env");
    }
    if (error.message.includes("401") || error.message.includes("auth")) {
      console.error("   Check your API keys in .env");
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
