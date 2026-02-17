// ============================================================
// Paper & Article Ingestion Script
// Usage: npx tsx scripts/ingest-paper.ts "DOI_OR_URL"
//
// Supports:
//   - DOIs: "10.1038/s41586-024-07386-0"
//   - DOI URLs: "https://doi.org/10.1038/..."
//   - arXiv: "https://arxiv.org/abs/2401.12345"
//   - PubMed: "https://pubmed.ncbi.nlm.nih.gov/12345678"
//   - Web articles: "https://example.com/article"
// ============================================================

import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MVP_USER_ID = "user_mvp";

function log(step: string, message: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] ${step}`);
  console.log(`  ${message}`);
}
function logDetail(msg: string) { console.log(`  → ${msg}`); }

// --- Source type detection ---
function detectType(url: string): "PAPER" | "ARTICLE" {
  const lower = url.toLowerCase();
  if (lower.startsWith("10.") || lower.includes("doi.org") || lower.includes("arxiv.org") ||
      lower.includes("pubmed") || lower.includes("ncbi.nlm.nih.gov") || lower.includes("semanticscholar.org") ||
      lower.includes("biorxiv.org") || lower.includes("medrxiv.org") || lower.includes("nature.com/articles") ||
      lower.includes("sciencedirect.com") || lower.endsWith(".pdf")) {
    return "PAPER";
  }
  return "ARTICLE";
}

// --- Paper: Semantic Scholar + PDF ---
async function fetchPaper(identifier: string) {
  log("📄 STEP 1: FETCHING PAPER", `Looking up: ${identifier}`);

  // Normalize identifier for Semantic Scholar
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

  const fields = "title,abstract,year,authors,citationCount,influentialCitationCount,fieldsOfStudy,journal,openAccessPdf,tldr,url";
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${fields}`);

  if (!res.ok) {
    if (res.status === 404) throw new Error("Paper not found on Semantic Scholar. Check the DOI/URL.");
    throw new Error(`Semantic Scholar error: ${res.status} ${res.statusText}`);
  }

  const metadata = await res.json();
  logDetail(`✅ Found: "${metadata.title}"`);
  logDetail(`Authors: ${metadata.authors.map((a: any) => a.name).join(", ")}`);
  logDetail(`Year: ${metadata.year} | Citations: ${metadata.citationCount}`);
  if (metadata.journal?.name) logDetail(`Journal: ${metadata.journal.name}`);
  if (metadata.tldr?.text) logDetail(`TL;DR: ${metadata.tldr.text.slice(0, 120)}...`);

  // Try to get full text from PDF
  let fullText = metadata.abstract || "";
  if (metadata.openAccessPdf?.url) {
    logDetail(`Open access PDF found — downloading...`);
    try {
      const pdfRes = await fetch(metadata.openAccessPdf.url);
      if (pdfRes.ok) {
        const buffer = Buffer.from(await pdfRes.arrayBuffer());
        // @ts-ignore
        const pdfParse = (await import("pdf-parse" as any)).default;
        const pdfData = await pdfParse(buffer);
        fullText = pdfData.text;
        logDetail(`✅ Extracted ${fullText.length} characters from PDF`);
      }
    } catch (e: any) {
      logDetail(`⚠️ PDF extraction failed (${e.message}), falling back to abstract`);
    }
  } else {
    logDetail(`No open access PDF — using abstract only`);
  }

  return {
    type: "PAPER" as const,
    title: metadata.title,
    author: metadata.authors.map((a: any) => a.name).join(", "),
    text: fullText,
    year: metadata.year,
    journal: metadata.journal?.name,
    abstract: metadata.abstract,
    citationCount: metadata.citationCount,
    url: metadata.url || identifier,
  };
}

// --- Article: Web scraping ---
async function fetchArticle(url: string) {
  log("📝 STEP 1: FETCHING ARTICLE", `Downloading: ${url}`);

  const res = await fetch(url, {
    headers: { "User-Agent": "NexusKnowledgeEngine/1.0 (Research Tool)" },
  });
  if (!res.ok) throw new Error(`Failed to fetch article: ${res.status} ${res.statusText}`);

  const html = await res.text();
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);

  // Clean up
  $("script, style, nav, footer, header, aside, .ad, .advertisement, .sidebar, .comments").remove();

  // Find main content
  const selectors = ["article", "[role='main']", ".post-content", ".article-body", ".entry-content", ".story-body", "main", ".content"];
  let articleText = "";
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length > 0 && el.text().trim().length > 200) {
      articleText = el.text().trim();
      break;
    }
  }
  if (!articleText) articleText = $("body").text().trim();
  articleText = articleText.replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const title = $('meta[property="og:title"]').attr("content") || $("title").text() || $("h1").first().text() || "Untitled Article";
  const author = $('meta[name="author"]').attr("content") || $('meta[property="article:author"]').attr("content") || $('[rel="author"]').first().text() || "Unknown Author";
  const publishDate = $('meta[property="article:published_time"]').attr("content") || $('meta[name="date"]').attr("content") || $("time").first().attr("datetime");

  logDetail(`✅ Title: "${title.trim()}"`);
  logDetail(`Author: ${author.trim()}`);
  logDetail(`Text: ${articleText.length} characters extracted`);

  return {
    type: "ARTICLE" as const,
    title: title.trim(),
    author: author.trim(),
    text: articleText,
    url,
    publishDate,
  };
}

// --- Shared: Extract claims with Claude ---
async function extractClaims(text: string, title: string, sourceType: string) {
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

// --- Shared: Theme detection ---
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
[{ "name": "Theme Name", "relevance": 0.95, "isNew": false }]

RULES: Prefer existing themes. Only suggest NEW if genuinely new domain. 1-4 themes per source.
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

// --- Shared: Contradiction detection ---
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

// --- Store results ---
async function storeResults(fetchResult: any, extraction: any, themeData: any, contradictions: any[]) {
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
      publicationDate: fetchResult.year ? new Date(`${fetchResult.year}-01-01`) : fetchResult.publishDate ? new Date(fetchResult.publishDate) : new Date(),
    },
  });
  logDetail(`Source saved: ${source.id}`);

  // Themes
  const themeMap = new Map<string, string>();
  for (const t of themeData.themes) {
    let themeId: string;
    if (t.isNew) {
      const newTheme = await prisma.theme.create({
        data: { name: t.name, slug: t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""), isAutoGenerated: true },
      });
      themeId = newTheme.id;
      logDetail(`Created theme: ${t.name}`);
    } else {
      const existing = themeData.existingThemes.find((et: any) => et.name.toLowerCase() === t.name.toLowerCase());
      if (!existing) continue;
      themeId = existing.id;
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
      } catch {}
    }
  }
  if (contradictionCount > 0) logDetail(`${contradictionCount} contradictions linked`);

  return { sourceId: source.id, claimCount: claimIds.length };
}

// --- Main ---
async function main() {
  const input = process.argv[2];
  if (!input) {
    console.log("\n❌ Usage: npx tsx scripts/ingest-paper.ts \"DOI_OR_URL\"\n");
    console.log("Examples:");
    console.log('  npx tsx scripts/ingest-paper.ts "10.1038/s41586-024-07386-0"');
    console.log('  npx tsx scripts/ingest-paper.ts "https://doi.org/10.1038/..."');
    console.log('  npx tsx scripts/ingest-paper.ts "https://arxiv.org/abs/2401.12345"');
    console.log('  npx tsx scripts/ingest-paper.ts "https://example.com/some-article"');
    process.exit(1);
  }

  const sourceType = detectType(input);
  console.log("\n" + "═".repeat(60));
  console.log(`  🔮 NEXUS — ${sourceType === "PAPER" ? "Paper" : "Article"} Ingestion Pipeline`);
  console.log("═".repeat(60));

  try {
    const fetchResult = sourceType === "PAPER" ? await fetchPaper(input) : await fetchArticle(input);
    const extraction = await extractClaims(fetchResult.text, fetchResult.title, sourceType);
    const themeData = await detectThemes(extraction.claims, extraction.title, extraction.summary);
    const contradictions = await detectContradictions(extraction.claims);
    const result = await storeResults(fetchResult, extraction, themeData, contradictions);

    console.log("\n" + "═".repeat(60));
    console.log("  ✅ INGESTION COMPLETE");
    console.log("═".repeat(60));
    console.log(`\n  Source ID:      ${result.sourceId}`);
    console.log(`  Type:           ${sourceType}`);
    console.log(`  Claims added:   ${result.claimCount}`);
    console.log(`  Themes:         ${themeData.themes.map((t: any) => t.name).join(", ")}`);
    console.log(`  Contradictions: ${contradictions.length}`);
    console.log(`\n  Claims are in your review queue! 🎯\n`);

  } catch (error: any) {
    console.error("\n❌ Pipeline error:", error.message);
    if (error.message.includes("Paper not found")) console.error("   The DOI/URL wasn't found on Semantic Scholar. Check the identifier.");
    if (error.message.includes("fetch")) console.error("   Network error — check your internet connection.");
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
