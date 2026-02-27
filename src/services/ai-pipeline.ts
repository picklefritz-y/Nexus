// ============================================================
// AI Processing Pipeline
// Uses Claude API to extract claims, detect themes,
// find contradictions, and generate review prompts
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  ExtractedClaim,
  ThemeSuggestion,
  ContradictionDetection,
  ProcessingResult,
  ReviewPrompt,
  PromptType,
} from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = "claude-sonnet-4-20250514";

// ============================================================
// 1. Content Summarization & Claim Extraction
// ============================================================

export async function extractClaimsAndSummary(
  text: string,
  sourceTitle: string,
  sourceType: string
): Promise<{
  summary: string;
  keyTakeaways: string[];
  claims: ExtractedClaim[];
}> {
  const prompt = `You are a scientific knowledge extraction system. Analyze the following ${sourceType} content and extract structured information.

SOURCE TITLE: "${sourceTitle}"
SOURCE TYPE: ${sourceType}

CONTENT:
${text.slice(0, 50000)} ${text.length > 50000 ? "\n[...content truncated...]" : ""}

Respond with valid JSON matching this exact structure:
{
  "summary": "A 2-3 paragraph summary of the key points and arguments",
  "keyTakeaways": ["takeaway 1", "takeaway 2", ...],
  "claims": [
    {
      "text": "A discrete, falsifiable claim stated as a clear assertion",
      "explanation": "2-3 sentence explanation of the evidence behind this claim",
      "implications": "What this means practically or what follows from it",
      "methodology": "How the evidence was gathered (for research papers) or null",
      "confidence": 0.85,
      "supportingQuote": "Exact quote from the source that supports this claim",
      "timestamp": "HH:MM:SS if from a podcast, otherwise null",
      "pageNumber": null
    }
  ]
}

EXTRACTION RULES:
- Extract DISCRETE CLAIMS: each should be a single, specific, testable assertion
- NOT summaries or opinions — factual claims that can be verified or contradicted
- Confidence score: 0.0-1.0 based on strength of evidence presented
  - 0.9+ = randomized controlled trial, meta-analysis, strong consensus
  - 0.7-0.9 = single well-designed study, multiple expert opinions
  - 0.5-0.7 = observational data, emerging research, expert hypothesis
  - 0.3-0.5 = anecdotal, speculative, extrapolation from limited data
- Include the SUPPORTING QUOTE — the exact text passage backing the claim
- Aim for 5-15 claims depending on content length and density
- For podcasts, include timestamps if present in the transcript
- For papers, include page numbers if identifiable

Return ONLY valid JSON, no markdown formatting or code blocks.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  // Clean and parse the response
  const cleaned = content.text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  return JSON.parse(cleaned);
}

// ============================================================
// 2. Theme Detection & Suggestion
// ============================================================

export async function detectThemes(
  claims: ExtractedClaim[],
  sourceTitle: string,
  sourceSummary: string,
  existingThemes: string[]
): Promise<ThemeSuggestion[]> {
  const prompt = `You are a knowledge categorization system. Given extracted claims and a source summary, identify the relevant knowledge themes/domains.

SOURCE: "${sourceTitle}"
SUMMARY: ${sourceSummary}

CLAIMS:
${claims.map((c, i) => `${i + 1}. "${c.text}"`).join("\n")}

EXISTING THEMES IN THE SYSTEM:
${existingThemes.length > 0 ? existingThemes.join(", ") : "(none yet)"}

Respond with valid JSON — an array of theme suggestions:
[
  {
    "name": "Theme Name",
    "relevance": 0.95,
    "isNew": false,
    "domain": "Psychedelic Science"
  }
]

RULES:
- PREFER existing themes when the content fits — don't create duplicates
- Only suggest a NEW theme if the content genuinely doesn't fit any existing theme
- Theme names should be broad enough to encompass multiple sources but specific enough to be meaningful
  - GOOD: "Mitochondrial Function", "Monetary Policy", "Sleep Architecture"
  - BAD: "Biology" (too broad), "PGC-1α in Zone 2" (too narrow)
- Relevance score: 0-1, how central this theme is to the source content
- Typically 1-4 themes per source
- New theme names should use Title Case
- "domain" field: identify the high-level domain this content belongs to. Use one of: "Psychedelic Science", "AI & Technology", "Health & Longevity", "Economics & Finance", or "General"

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const cleaned = content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================
// 3. Contradiction & Consensus Detection
// ============================================================

export async function detectContradictions(
  newClaims: ExtractedClaim[],
  existingClaims: { id: string; text: string; themes: string[]; status: string; confidence: number }[]
): Promise<ContradictionDetection[]> {
  if (existingClaims.length === 0) return [];

  const prompt = `You are a scientific contradiction detection system. Compare new claims against existing claims in the knowledge base to identify contradictions, nuances, and supersessions.

NEW CLAIMS:
${newClaims.map((c, i) => `NEW-${i + 1}: "${c.text}" (confidence: ${c.confidence})`).join("\n")}

EXISTING CLAIMS IN KNOWLEDGE BASE:
${existingClaims.map(c => `[${c.id}] "${c.text}" (status: ${c.status}, confidence: ${c.confidence}, themes: ${c.themes.join(", ")})`).join("\n")}

Respond with valid JSON — an array of detected contradictions (empty array if none found):
[
  {
    "newClaimText": "The exact text of the new claim",
    "existingClaimId": "the_id_of_the_existing_claim",
    "existingClaimText": "The text of the existing claim being contradicted",
    "explanation": "Clear explanation of HOW these claims contradict or modify each other",
    "severity": 0.7,
    "type": "direct_contradiction"
  }
]

DETECTION RULES:
- "direct_contradiction": Claims directly oppose each other (A says X, B says not-X)
- "nuance": New claim adds important context that modifies interpretation of existing claim
- "supersession": New evidence renders old claim outdated or incomplete
- "scope_limitation": New claim shows existing claim only applies in narrower conditions

SEVERITY SCALE:
- 0.9-1.0: Fundamental disagreement, mutually exclusive claims
- 0.6-0.8: Significant contradiction requiring resolution
- 0.3-0.5: Minor nuance or scope limitation
- 0.1-0.2: Subtle qualification, both claims can mostly coexist

IMPORTANT:
- Only flag GENUINE contradictions, not mere differences in topic
- Two claims about different things are NOT contradictions
- Claims must be about the SAME subject matter to contradict
- Be conservative — false positives are worse than false negatives

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const cleaned = content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================
// 4. Consensus Status Recalculation
// ============================================================

export async function recalculateClaimStatus(
  claim: { id: string; text: string; confidence: number },
  supportingSources: { title: string; type: string; author: string }[],
  contradictions: { claimText: string; severity: number; sourceTitle: string }[]
): Promise<{ status: string; confidence: number; explanation: string }> {
  const prompt = `Given a claim and its supporting/contradicting evidence, determine its current status.

CLAIM: "${claim.text}"

SUPPORTING SOURCES (${supportingSources.length}):
${supportingSources.map(s => `- ${s.title} by ${s.author} (${s.type})`).join("\n")}

CONTRADICTIONS (${contradictions.length}):
${contradictions.length > 0
    ? contradictions.map(c => `- "${c.claimText}" (severity: ${c.severity}) from ${c.sourceTitle}`).join("\n")
    : "(none)"}

Respond with JSON:
{
  "status": "consensus|supported|emerging|contested|contradicted",
  "confidence": 0.85,
  "explanation": "Brief explanation of why this status was assigned"
}

STATUS DEFINITIONS:
- consensus: 3+ sources agree, no significant contradictions
- supported: 1-2 strong sources, no contradictions
- emerging: New claim with limited evidence
- contested: Active contradictions exist, evidence is mixed
- contradicted: Weight of evidence has shifted against this claim

Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const cleaned = content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================
// 5. Review Prompt Generation
// ============================================================

export async function generateReviewPrompts(
  claims: { id: string; text: string; themes: string[]; status: string }[],
  relatedClaims: { id: string; text: string; relationship: string }[]
): Promise<ReviewPrompt[]> {
  const prompts: ReviewPrompt[] = [];

  for (const claim of claims) {
    // Rotate through prompt types based on claim properties
    const related = relatedClaims.filter(
      rc => claims.find(c => c.id === claim.id)?.themes.some(
        t => relatedClaims.some(rc2 => rc2.id === rc.id)
      )
    );

    // Type 1: Factual Recall
    prompts.push({
      type: "recall",
      question: `What does the evidence say about this topic?`,
      claimId: claim.id,
      claimText: claim.text,
      themes: claim.themes,
    });

    // Type 2: Reflection (for claims reviewed 3+ times)
    prompts.push({
      type: "reflection",
      question: `Do you still agree with this claim? Has your understanding evolved?`,
      claimId: claim.id,
      claimText: claim.text,
      themes: claim.themes,
    });

    // Type 3: Correlation (when related/contradicting claims exist)
    if (related.length > 0) {
      prompts.push({
        type: "correlation",
        question: `How does this connect to or conflict with related claims you've studied?`,
        claimId: claim.id,
        claimText: claim.text,
        themes: claim.themes,
        relatedClaims: related.map(r => ({
          id: r.id,
          text: r.text,
          relationship: r.relationship as "supports" | "contradicts" | "related",
        })),
      });
    }
  }

  return prompts;
}

// ============================================================
// 6. Weekly Digest Generation
// ============================================================

export async function generateWeeklyDigest(
  newSources: { title: string; type: string; author: string }[],
  newClaims: { text: string; status: string; themes: string[] }[],
  contradictions: { newClaim: string; existingClaim: string; explanation: string }[],
  reviewStats: { completed: number; avgRetention: number },
  themes: string[]
): Promise<{
  summary: string;
  keyInsights: string[];
  recommendations: string[];
}> {
  const prompt = `Generate a weekly knowledge digest for a personal learning system.

THIS WEEK'S ACTIVITY:
- ${newSources.length} new sources added
- ${newClaims.length} new claims extracted
- ${reviewStats.completed} reviews completed (avg retention: ${Math.round(reviewStats.avgRetention * 100)}%)

NEW SOURCES:
${newSources.map(s => `- ${s.title} by ${s.author} (${s.type})`).join("\n")}

NEW CLAIMS BY THEME:
${themes.map(t => {
    const themeClaims = newClaims.filter(c => c.themes.includes(t));
    if (themeClaims.length === 0) return null;
    return `${t}:\n${themeClaims.map(c => `  - "${c.text}" [${c.status}]`).join("\n")}`;
  }).filter(Boolean).join("\n\n")}

NEW CONTRADICTIONS:
${contradictions.length > 0
    ? contradictions.map(c => `- "${c.newClaim}" vs "${c.existingClaim}": ${c.explanation}`).join("\n")
    : "(none this week)"}

Respond with JSON:
{
  "summary": "2-3 paragraph narrative summary of the week's learning. Write in second person ('You explored...', 'Your understanding of...'). Highlight connections between sources and any shifts in understanding.",
  "keyInsights": ["insight 1", "insight 2", ...],
  "recommendations": ["recommendation 1", "recommendation 2", ...]
}

KEY INSIGHTS should be cross-source connections or emerging patterns.
RECOMMENDATIONS should suggest what to review, what to explore next, or what contradictions to investigate.

Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const cleaned = content.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}
