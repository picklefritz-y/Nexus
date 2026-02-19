// POST /api/tables/generate
// Generate structured data tables from the knowledge base using AI

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

const MVP_USER_ID = "user_mvp";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-20250514";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ success: false, error: "Prompt required" }, { status: 400 });
    }

    // Step 1: Extract search keywords
    const keywords = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w: string) => w.length > 3 && !STOP_WORDS.has(w));

    const searchTerms = keywords.slice(0, 10);

    // Step 2: Search claims
    const relevantClaims = await prisma.claim.findMany({
      where: {
        OR: searchTerms.flatMap((term: string) => [
          { text: { contains: term, mode: "insensitive" as const } },
          { explanation: { contains: term, mode: "insensitive" as const } },
          { implications: { contains: term, mode: "insensitive" as const } },
        ]),
      },
      include: {
        sources: {
          include: {
            source: { select: { id: true, title: true, author: true, type: true, url: true, publicationDate: true } },
          },
        },
        themes: {
          include: { theme: { select: { name: true } } },
        },
        contradicts: {
          include: { contradicted: { select: { id: true, text: true } } },
        },
        contradictedBy: {
          include: { claim: { select: { id: true, text: true } } },
        },
      },
      take: 50,
    });

    // Step 3: Search sources
    const relevantSources = await prisma.source.findMany({
      where: {
        userId: MVP_USER_ID,
        status: "COMPLETE",
        OR: searchTerms.flatMap((term: string) => [
          { title: { contains: term, mode: "insensitive" as const } },
          { summary: { contains: term, mode: "insensitive" as const } },
          { rawText: { contains: term, mode: "insensitive" as const } },
        ]),
      },
      select: {
        id: true, title: true, author: true, type: true, url: true,
        summary: true, rawText: true, publicationDate: true,
      },
      take: 15,
    });

    // Step 4: Build context
    const claimContext = relevantClaims.map((c: any, i: number) => {
      const sources = c.sources.map((s: any) => `${s.source.title} (${s.source.author || "Unknown"}, ${s.source.publicationDate?.split("T")[0] || "n.d."})`).join("; ");
      const themes = c.themes.map((t: any) => t.theme.name).join(", ");
      const contradictions = [
        ...c.contradicts.map((ct: any) => ct.contradicted.text),
        ...c.contradictedBy.map((ct: any) => ct.claim.text),
      ];
      return `[CLAIM ${i + 1}] (Status: ${c.status}, Confidence: ${Math.round((c.confidence || 0.5) * 100)}%)
"${c.text}"
${c.explanation ? `Explanation: ${c.explanation}` : ""}
Sources: ${sources || "Unknown"}
Themes: ${themes || "Uncategorized"}
${contradictions.length > 0 ? `Contradicted by: ${contradictions.join("; ")}` : ""}`;
    }).join("\n\n");

    const sourceContext = relevantSources.map((s: any, i: number) => {
      const textExcerpt = s.rawText ? s.rawText.slice(0, 4000) : s.summary || "";
      return `[SOURCE ${i + 1}] "${s.title}" by ${s.author || "Unknown"} (${s.type}, ${s.publicationDate?.split("T")[0] || "n.d."})
${s.url ? `URL: ${s.url}` : ""}
${textExcerpt}`;
    }).join("\n\n---\n\n");

    // Step 5: Generate table via Claude
    const systemPrompt = `You are a data analyst for Nexus, a personal knowledge management system. Your job is to create structured data tables from the user's knowledge base.

You will receive a prompt describing what table the user wants, along with claims and source text from their knowledge base.

RESPOND WITH ONLY VALID JSON — no markdown, no backticks, no explanation. The JSON must match this exact schema:

{
  "title": "Short descriptive title for the table",
  "description": "1-2 sentence description of what this table shows",
  "columns": [
    { "key": "column_id", "label": "Column Header", "type": "text" }
  ],
  "rows": [
    { "column_id": "cell value", "column_id2": "cell value 2" }
  ],
  "footnotes": "Optional notes about methodology, gaps in data, or caveats"
}

COLUMN TYPE OPTIONS:
- "text" — general text
- "number" — numeric values (include units in the cell value as a string)
- "status" — status indicators (e.g., "Supported", "Contested", "Emerging")
- "confidence" — confidence percentage (e.g., "90%")
- "source" — source citation

RULES:
1. ONLY use data from the provided claims and sources — never fabricate data
2. Every cell should be traceable to a specific claim or source
3. Use "—" for cells where data is not available in the knowledge base
4. Include a "source" column when helpful to show where data comes from
5. Make column keys short, lowercase, snake_case identifiers
6. Keep cell values concise but informative
7. Order rows logically (e.g., by importance, chronology, or as specified)
8. Aim for completeness — include all relevant data points from the knowledge base
9. If claims contradict each other, include both and note the conflict
10. Include confidence levels when they differ meaningfully across rows

KNOWLEDGE BASE CONTEXT:

=== EXTRACTED CLAIMS ===
${claimContext || "No matching claims found."}

=== SOURCE EXCERPTS ===
${sourceContext || "No matching source text found."}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Parse JSON — strip any markdown fencing if present
    const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const tableData = JSON.parse(cleaned);

    // Validate structure
    if (!tableData.columns || !tableData.rows || !Array.isArray(tableData.columns) || !Array.isArray(tableData.rows)) {
      return NextResponse.json({ success: false, error: "Invalid table structure returned" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...tableData,
        meta: {
          claimsSearched: relevantClaims.length,
          sourcesSearched: relevantSources.length,
          searchTerms,
          generatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    console.error("Table generation error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "also", "been", "before",
  "being", "below", "between", "both", "could", "does", "doing", "down",
  "during", "each", "from", "further", "have", "having", "here", "hers",
  "herself", "himself", "into", "itself", "just", "more", "most", "myself",
  "once", "only", "other", "ourselves", "over", "same", "shan", "should",
  "some", "such", "than", "that", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "under",
  "until", "very", "what", "when", "where", "which", "while", "whom", "will",
  "with", "would", "your", "yours", "yourself", "yourselves", "tell", "know",
  "think", "make", "like", "want", "come", "take", "find", "give", "well",
  "create", "table", "compare", "comparison", "show", "list", "data",
  "generate", "build", "across", "between",
]);
