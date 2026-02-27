// ============================================================
// Unified Ingestion Script
// Usage: npx tsx scripts/ingest.ts "ANY_URL"
//
// Supports:
//   - DOIs: "https://doi.org/10.1038/..."
//   - Papers: arXiv, PubMed, bioRxiv, etc.
//   - PDFs: any URL ending in .pdf
//   - YouTube/Podcasts: "https://youtube.com/watch?v=..."
//   - Articles: any web URL
//
// Uses @steipete/summarize as the primary extraction layer.
// Falls back to AssemblyAI for podcasts if summarize fails.
// ============================================================

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MVP_USER_ID = "user_mvp";

// --- Logging ---

function log(step: string, message: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] ${step}`);
  console.log(`  ${message}`);
}
function logDetail(msg: string) { console.log(`  → ${msg}`); }

// --- Source type detection ---

type SourceType = "PAPER" | "ARTICLE" | "PODCAST";

function detectType(url: string): SourceType {
  const lower = url.toLowerCase();

  // Podcast/video detection
  if (lower.includes("youtube.com") || lower.includes("youtu.be") ||
      lower.includes("spotify.com/episode") || lower.includes("podcasts.apple.com") ||
      lower.includes("anchor.fm") || lower.includes("podbean.com") ||
      lower.includes("buzzsprout.com") || lower.includes("transistor.fm")) {
    return "PODCAST";
  }

  // Paper/academic detection
  if (lower.startsWith("10.") || lower.includes("doi.org") || lower.includes("arxiv.org") ||
      lower.includes("pubmed") || lower.includes("ncbi.nlm.nih.gov") || lower.includes("semanticscholar.org") ||
      lower.includes("biorxiv.org") || lower.includes("medrxiv.org") || lower.includes("nature.com/articles") ||
      lower.includes("sciencedirect.com") || lower.endsWith(".pdf")) {
    return "PAPER";
  }

  return "ARTICLE";
}

// --- Step 1: Content extraction via summarize CLI ---

interface ExtractedContent {
  title: string;
  author: string;
  text: string;
  url: string;
  type: SourceType;
  year?: number;
  journal?: string;
  abstract?: string;
  durationSeconds?: number;
  publishDate?: string;
}

async function extractWithSummarize(url: string): Promise<string> {
  log("📥 STEP 1a: EXTRACTING WITH SUMMARIZE", `Running: summarize "${url}" --extract`);

  try {
    const output = execFileSync("summarize", [url, "--extract", "--format", "text"], {
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });

    const text = output.trim();
    if (!text || text.length < 50) {
      throw new Error(`Summarize returned insufficient content (${text.length} chars)`);
    }

    logDetail(`✅ Extracted ${text.length} characters`);
    return text;
  } catch (e: any) {
    throw new Error(`summarize extraction failed: ${e.message}`);
  }
}

// --- Fallback: Semantic Scholar for papers ---

async function fetchPaperMetadata(identifier: string) {
  log("📄 STEP 1b: FETCHING PAPER METADATA", `Looking up: ${identifier}`);

  let paperId = identifier;
  if (identifier.startsWith("10.") || identifier.includes("doi.org/")) {
    paperId = `DOI:${identifier.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
  } else if (identifier.includes("arxiv.org")) {
    const match = identifier.match(/(\d{4}\.\d{4,5})/);
    if (match) paperId = `ARXIV:${match[1]}`;
  } else if (identifier.includes("pubmed.ncbi.nlm.nih.gov")) {
    const match = identifier.match(/\/(\d+)/);
    if (match) paperId = `PMID:${match[1]}`;
  }

  logDetail(`Querying Semantic Scholar: ${paperId}`);
  const fields = "title,abstract,year,authors,citationCount,journal,openAccessPdf,url";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${fields}`);

  if (!res.ok) return null;

  const metadata = await res.json();
  logDetail(`✅ Found: "${metadata.title}"`);
  logDetail(`Authors: ${metadata.authors?.map((a: any) => a.name).join(", ")}`);
  if (metadata.year) logDetail(`Year: ${metadata.year}`);
  if (metadata.journal?.name) logDetail(`Journal: ${metadata.journal.name}`);

  return {
    title: metadata.title || "",
    author: metadata.authors?.map((a: any) => a.name).join(", ") || "",
    year: metadata.year,
    journal: metadata.journal?.name,
    abstract: metadata.abstract,
    url: metadata.url || identifier,
  };
}

// --- Fallback: AssemblyAI transcription for podcasts ---

async function transcribeWithAssemblyAI(url: string) {
  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY not set in .env — cannot fall back to transcription");
  }

  const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

  log("📡 STEP 1b: ASSEMBLYAI FALLBACK", `Transcribing: ${url}`);

  // Download audio with yt-dlp
  const audioDir = path.join(process.cwd(), "audio");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, `podcast-${Date.now()}.m4a`);

  logDetail("Downloading audio with yt-dlp...");
  try {
    execFileSync("yt-dlp", [
      "-f", "bestaudio[ext=m4a]/bestaudio",
      "-o", audioPath,
      "--no-playlist",
      url,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600000,
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
    headers: { Authorization: ASSEMBLYAI_KEY, "Content-Type": "application/octet-stream" },
    body: audioData,
  });

  if (!uploadResponse.ok) throw new Error(`AssemblyAI upload failed: ${uploadResponse.status}`);
  const { upload_url } = await uploadResponse.json();
  logDetail("✅ Audio uploaded to AssemblyAI");

  fs.unlinkSync(audioPath);

  // Submit for transcription
  logDetail("Submitting for transcription...");
  const submitResponse = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: { Authorization: ASSEMBLYAI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, auto_chapters: true, speaker_labels: true }),
  });

  if (!submitResponse.ok) throw new Error(`AssemblyAI submit failed: ${submitResponse.status}`);
  const { id } = await submitResponse.json();
  logDetail(`Job submitted: ${id}`);
  logDetail("Polling for completion...");

  // Poll
  let dots = 0;
  while (true) {
    const pollResponse = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { Authorization: ASSEMBLYAI_KEY },
    });
    const data = await pollResponse.json();

    if (data.status === "completed") {
      const durationMin = Math.round((data.audio_duration || 0) / 60);
      logDetail(`✅ Transcription complete! Duration: ${durationMin} minutes, ${data.text?.length || 0} chars`);
      return {
        text: data.text || "",
        durationSeconds: Math.round(data.audio_duration || 0),
        chapters: data.chapters,
      };
    }

    if (data.status === "error") throw new Error(`Transcription failed: ${data.error}`);

    dots = (dots + 1) % 4;
    process.stdout.write(`\r  ⏳ Status: ${data.status} ${".".repeat(dots + 1)}${"  ".repeat(3 - dots)}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// --- Fetch content: summarize first, then fallbacks ---

async function fetchContent(url: string, sourceType: SourceType): Promise<ExtractedContent> {
  let text = "";
  let title = "";
  let author = "";
  let year: number | undefined;
  let journal: string | undefined;
  let abstract: string | undefined;
  let durationSeconds: number | undefined;
  let publishDate: string | undefined;

  // Try summarize first
  let summarizeWorked = false;
  try {
    text = await extractWithSummarize(url);
    summarizeWorked = true;
  } catch (e: any) {
    logDetail(`⚠️ Summarize failed: ${e.message}`);
  }

  // For papers, try to get metadata from Semantic Scholar
  if (sourceType === "PAPER") {
    const metadata = await fetchPaperMetadata(url);
    if (metadata) {
      title = metadata.title;
      author = metadata.author;
      year = metadata.year;
      journal = metadata.journal;
      abstract = metadata.abstract;
    }

    // If summarize failed for papers, try PDF fallback
    if (!summarizeWorked) {
      if (abstract) {
        logDetail("Using abstract as fallback text");
        text = abstract;
      } else {
        throw new Error("Could not extract paper content. Try installing summarize: npm i -g @steipete/summarize");
      }
    }
  }

  // For podcasts, fall back to AssemblyAI if summarize failed
  if (sourceType === "PODCAST" && !summarizeWorked) {
    logDetail("Falling back to AssemblyAI transcription pipeline...");
    const transcript = await transcribeWithAssemblyAI(url);
    text = transcript.text;
    durationSeconds = transcript.durationSeconds;
  }

  // For articles, if summarize failed, try basic HTML scraping
  if (sourceType === "ARTICLE" && !summarizeWorked) {
    logDetail("Falling back to HTML scraping...");
    const res = await fetch(url, {
      headers: { "User-Agent": "NexusKnowledgeEngine/1.0 (Research Tool)" },
    });
    if (!res.ok) throw new Error(`Failed to fetch article: ${res.status}`);

    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    $("script, style, nav, footer, header, aside, .ad, .advertisement, .sidebar, .comments").remove();

    const selectors = ["article", "[role='main']", ".post-content", ".article-body", ".entry-content", ".story-body", "main", ".content"];
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length > 0 && el.text().trim().length > 200) {
        text = el.text().trim();
        break;
      }
    }
    if (!text) text = $("body").text().trim();
    text = text.replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    title = $('meta[property="og:title"]').attr("content") || $("title").text() || $("h1").first().text() || "";
    author = $('meta[name="author"]').attr("content") || $('meta[property="article:author"]').attr("content") || $('[rel="author"]').first().text() || "";
    publishDate = $('meta[property="article:published_time"]').attr("content") || $('meta[name="date"]').attr("content") || $("time").first().attr("datetime");
  }

  if (!text || text.length < 50) {
    throw new Error("Could not extract sufficient content from the URL");
  }

  logDetail(`Final text: ${text.length} characters`);

  return {
    title: title || "Untitled",
    author: author || "Unknown Author",
    text,
    url,
    type: sourceType,
    year,
    journal,
    abstract,
    durationSeconds,
    publishDate,
  };
}

// --- Step 2: Extract claims with Claude ---

async function extractClaims(text: string, title: string, sourceType: SourceType) {
  const textForProcessing = text.slice(0, 50000);
  log("🧠 STEP 2: CLAIM EXTRACTION", `Sending ${textForProcessing.length} chars to Claude...`);

  const prompt = `You are a scientific knowledge extraction system. Analyze the following ${sourceType} content and extract structured information.

SOURCE TITLE: "${title}"
SOURCE TYPE: ${sourceType}

CONTENT:
${textForProcessing}

Respond with valid JSON matching this exact structure:
{
  "title": "Clean title of the content",
  "author": "Author name(s)",
  "summary": "2-3 paragraph summary",
  "keyTakeaways": ["takeaway 1", "takeaway 2"],
  "claims": [
    {
      "text": "A discrete, falsifiable claim",
      "explanation": "2-3 sentence explanation with evidence",
      "implications": "Practical implications",
      "confidence": 0.85,
      "supportingQuote": "Relevant quote from the text"
    }
  ]
}

RULES:
- Extract DISCRETE CLAIMS: single, specific, testable assertions
- NOT summaries or opinions — factual claims that can be verified
- Confidence: 0.9+ strong evidence, 0.7-0.9 study cited, 0.5-0.7 expert opinion, 0.3-0.5 anecdotal
- Aim for 5-15 claims depending on density
- For papers: focus on methodology findings, key results, and conclusions
- For podcasts: focus on factual claims with supporting quotes from transcript
- For articles: focus on factual assertions with evidence

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response");
  const result = JSON.parse(content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

  logDetail(`✅ Extracted: "${result.title}"`);
  logDetail(`Claims: ${result.claims.length}`);
  result.claims.forEach((c: any, i: number) => {
    logDetail(`  ${i + 1}. [${(c.confidence * 100).toFixed(0)}%] ${c.text.slice(0, 100)}...`);
  });

  return result;
}

// --- Step 3: Theme detection ---

async function detectThemes(claims: any[], title: string, summary: string) {
  log("🏷️  STEP 3: THEME DETECTION", "Identifying knowledge domains...");

  const existingThemes = await prisma.theme.findMany({ select: { id: true, name: true } });
  const existingNames = existingThemes.map(t => t.name);

  const prompt = `Given claims and summary, identify relevant knowledge themes.

SOURCE: "${title}"
SUMMARY: ${summary}

CLAIMS:
${claims.map((c: any, i: number) => `${i + 1}. "${c.text}"`).join("\n")}

EXISTING THEMES: ${existingNames.length > 0 ? existingNames.join(", ") : "(none)"}

Respond with JSON array:
[{ "name": "Theme Name", "relevance": 0.95, "isNew": false, "domain": "Psychedelic Science" }]

RULES: Prefer existing themes. Only suggest NEW if genuinely new domain. 1-4 themes per source.
"domain" field: high-level domain — use one of: "Psychedelic Science", "AI & Technology", "Health & Longevity", "Economics & Finance", or "General"
Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL, max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response");
  const themes = JSON.parse(content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

  themes.forEach((t: any) => logDetail(`${t.isNew ? "🆕" : "📂"} ${t.name} (${(t.relevance * 100).toFixed(0)}%)`));
  return { themes, existingThemes };
}

// --- Step 4: Contradiction detection ---

async function detectContradictions(claims: any[]) {
  log("⚡ STEP 4: CONTRADICTION DETECTION", "Comparing against existing claims...");

  const existingClaims = await prisma.claim.findMany({
    include: { themes: { include: { theme: true } } },
  });

  if (existingClaims.length === 0) {
    logDetail("No existing claims — skipping.");
    return [];
  }

  logDetail(`Comparing ${claims.length} new vs ${existingClaims.length} existing...`);

  const prompt = `Compare new claims against existing claims for contradictions.

NEW CLAIMS:
${claims.map((c: any, i: number) => `NEW-${i + 1}: "${c.text}" (${c.confidence})`).join("\n")}

EXISTING CLAIMS:
${existingClaims.map(c => `[${c.id}] "${c.text}" (${c.status}, ${c.confidence})`).join("\n")}

Respond with JSON array (empty if none):
[{ "newClaimText": "...", "existingClaimId": "...", "existingClaimText": "...", "explanation": "...", "severity": 0.7, "type": "direct_contradiction" }]

Types: direct_contradiction | nuance | supersession | scope_limitation
Be conservative. Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL, max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response");
  const contradictions = JSON.parse(content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

  if (contradictions.length === 0) logDetail("No contradictions detected.");
  else contradictions.forEach((c: any) => logDetail(`⚡ ${c.type}: "${c.newClaimText.slice(0, 60)}..." vs "${c.existingClaimText.slice(0, 60)}..."`));
  return contradictions;
}

// --- Step 5: Store results ---

async function storeResults(fetchResult: ExtractedContent, extraction: any, themeData: any, contradictions: any[]) {
  log("💾 STEP 5: STORING IN DATABASE", "Saving source, claims, themes, review cards...");

  const source = await prisma.source.create({
    data: {
      userId: MVP_USER_ID,
      type: fetchResult.type,
      status: "COMPLETE",
      title: extraction.title || fetchResult.title,
      author: extraction.author || fetchResult.author,
      url: fetchResult.url,
      summary: extraction.summary,
      keyTakeaways: JSON.stringify(extraction.keyTakeaways),
      rawText: fetchResult.text?.slice(0, 100000),
      journal: fetchResult.journal,
      abstract: fetchResult.abstract,
      durationSeconds: fetchResult.durationSeconds,
      publicationDate: fetchResult.year
        ? new Date(`${fetchResult.year}-01-01`)
        : fetchResult.publishDate
          ? new Date(fetchResult.publishDate)
          : new Date(),
    },
  });
  logDetail(`Source saved: ${source.id}`);

  // Themes
  const themeMap = new Map<string, string>();
  for (const t of themeData.themes) {
    let themeId: string;

    let domainId: string | undefined;
    if (t.domain) {
      const slug = t.domain.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/&/g, "");
      const domain = await prisma.domain.upsert({
        where: { slug },
        update: {},
        create: { name: t.domain, slug, icon: "📂", isAutoGenerated: true },
      });
      domainId = domain.id;
    }

    if (t.isNew) {
      const newTheme = await prisma.theme.create({
        data: {
          name: t.name,
          slug: t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
          isAutoGenerated: true,
          ...(domainId ? { domainId } : {}),
        },
      });
      themeId = newTheme.id;
      logDetail(`Created theme: ${t.name} → ${t.domain || "General"}`);
    } else {
      const existing = themeData.existingThemes.find((et: any) => et.name.toLowerCase() === t.name.toLowerCase());
      if (!existing) continue;
      themeId = existing.id;
      if (domainId) {
        await prisma.theme.updateMany({ where: { id: themeId, domainId: null }, data: { domainId } });
      }
    }
    themeMap.set(t.name, themeId);
    await prisma.sourceTheme.create({ data: { sourceId: source.id, themeId, relevance: t.relevance } });
  }

  // Claims + review cards
  const claimIds: string[] = [];
  for (const c of extraction.claims) {
    const claim = await prisma.claim.create({
      data: { text: c.text, explanation: c.explanation, implications: c.implications, confidence: c.confidence, status: "EMERGING" },
    });
    claimIds.push(claim.id);
    await prisma.claimSource.create({ data: { claimId: claim.id, sourceId: source.id, extractedText: c.supportingQuote } });
    for (const [, themeId] of themeMap) {
      await prisma.claimTheme.create({ data: { claimId: claim.id, themeId } }).catch(() => {});
    }
    await prisma.reviewCard.create({
      data: { userId: MVP_USER_ID, claimId: claim.id, due: new Date(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0 },
    });
  }
  logDetail(`${claimIds.length} claims saved with review cards`);

  // Contradictions
  let contradictionCount = 0;
  for (const c of contradictions) {
    const newClaim = await prisma.claim.findFirst({ where: { text: c.newClaimText, id: { in: claimIds } } });
    if (newClaim) {
      try {
        await prisma.contradiction.create({ data: { claimId: newClaim.id, contradictedId: c.existingClaimId, explanation: c.explanation, severity: c.severity } });
        contradictionCount++;
        if (c.severity > 0.5) await prisma.claim.update({ where: { id: c.existingClaimId }, data: { status: "CONTESTED" } });
      } catch (_e) {}
    }
  }
  if (contradictionCount > 0) logDetail(`${contradictionCount} contradictions linked`);

  return { sourceId: source.id, claimCount: claimIds.length };
}

// --- Main ---

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.log("\n❌ Usage: npx tsx scripts/ingest.ts \"ANY_URL\"\n");
    console.log("Examples:");
    console.log('  npx tsx scripts/ingest.ts "https://doi.org/10.1038/s41586-024-07386-0"');
    console.log('  npx tsx scripts/ingest.ts "https://youtube.com/watch?v=..."');
    console.log('  npx tsx scripts/ingest.ts "https://example.com/some-article"');
    console.log('  npx tsx scripts/ingest.ts "https://arxiv.org/abs/2401.12345"');
    console.log('  npx tsx scripts/ingest.ts "https://example.com/paper.pdf"');
    console.log("\nRequires: npm i -g @steipete/summarize");
    console.log("Falls back to AssemblyAI for podcasts if summarize is unavailable.\n");
    process.exit(1);
  }

  const sourceType = detectType(input);
  const typeLabel = sourceType === "PAPER" ? "Paper" : sourceType === "PODCAST" ? "Podcast" : "Article";

  console.log("\n" + "═".repeat(60));
  console.log(`  🔮 NEXUS — Unified Ingestion Pipeline`);
  console.log(`  Source type: ${typeLabel} (auto-detected)`);
  console.log("═".repeat(60));

  try {
    const fetchResult = await fetchContent(input, sourceType);
    const extraction = await extractClaims(fetchResult.text, fetchResult.title, sourceType);

    // Use Claude's extracted title/author if our metadata fetch didn't find them
    if (fetchResult.title === "Untitled" && extraction.title) fetchResult.title = extraction.title;
    if (fetchResult.author === "Unknown Author" && extraction.author) fetchResult.author = extraction.author;

    const themeData = await detectThemes(extraction.claims, extraction.title, extraction.summary);
    const contradictions = await detectContradictions(extraction.claims);
    const result = await storeResults(fetchResult, extraction, themeData, contradictions);

    console.log("\n" + "═".repeat(60));
    console.log("  ✅ INGESTION COMPLETE");
    console.log("═".repeat(60));
    console.log(`\n  Source ID:      ${result.sourceId}`);
    console.log(`  Type:           ${typeLabel}`);
    console.log(`  Claims added:   ${result.claimCount}`);
    console.log(`  Themes:         ${themeData.themes.map((t: any) => t.name).join(", ")}`);
    console.log(`  Contradictions: ${contradictions.length}`);
    console.log(`\n  Claims are in your review queue! 🎯\n`);

  } catch (error: any) {
    console.error("\n❌ Pipeline error:", error.message);
    if (error.message.includes("summarize")) {
      console.error("   Install summarize: npm i -g @steipete/summarize");
    }
    if (error.message.includes("AssemblyAI") || error.message.includes("ASSEMBLYAI")) {
      console.error("   Check your ASSEMBLYAI_API_KEY in .env");
    }
    if (error.message.includes("Paper not found")) {
      console.error("   The DOI/URL wasn't found on Semantic Scholar. Check the identifier.");
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
