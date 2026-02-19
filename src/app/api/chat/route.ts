// POST /api/chat
// Conversational research assistant grounded in your knowledge base

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

const MVP_USER_ID = "user_mvp";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-sonnet-4-20250514";

export async function POST(request: NextRequest) {
  const { message, history } = await request.json();

  if (!message || typeof message !== "string") {
    return NextResponse.json({ success: false, error: "Message required" }, { status: 400 });
  }

  // Step 1: Search for relevant claims and sources
  const keywords = message
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w: string) => w.length > 3 && !STOP_WORDS.has(w));

  const searchTerms = keywords.slice(0, 8);

  // Search claims by text, explanation, implications
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
          source: { select: { id: true, title: true, author: true, type: true, url: true } },
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
    take: 30,
  });

  // Search sources by title, summary, rawText
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
      id: true,
      title: true,
      author: true,
      type: true,
      url: true,
      summary: true,
      rawText: true,
    },
    take: 10,
  });

  // Step 2: Build context from retrieved data
  const claimContext = relevantClaims.map((c: any, i: number) => {
    const sources = c.sources.map((s: any) => `${s.source.title} (${s.source.author || "Unknown"})`).join(", ");
    const themes = c.themes.map((t: any) => t.theme.name).join(", ");
    const contradictions = [
      ...c.contradicts.map((ct: any) => ct.contradicted.text),
      ...c.contradictedBy.map((ct: any) => ct.claim.text),
    ];
    return `[CLAIM ${i + 1}] (Status: ${c.status}, Confidence: ${Math.round((c.confidence || 0.5) * 100)}%)
"${c.text}"
${c.explanation ? `Explanation: ${c.explanation}` : ""}
${c.implications ? `Implications: ${c.implications}` : ""}
Sources: ${sources || "Unknown"}
Themes: ${themes || "Uncategorized"}
${contradictions.length > 0 ? `⚡ Contradicted by: ${contradictions.join("; ")}` : ""}`;
  }).join("\n\n");

  const sourceContext = relevantSources.map((s: any, i: number) => {
    const textExcerpt = s.rawText ? s.rawText.slice(0, 3000) : s.summary || "";
    return `[SOURCE ${i + 1}] "${s.title}" by ${s.author || "Unknown"} (${s.type})
${s.url ? `URL: ${s.url}` : ""}
${textExcerpt}`;
  }).join("\n\n---\n\n");

  const totalClaims = await prisma.claim.count();
  const totalSources = await prisma.source.count({ where: { userId: MVP_USER_ID, status: "COMPLETE" } });

  // Step 3: Send to Claude with full context
  const systemPrompt = `You are a research assistant for Nexus, a personal knowledge management system. The user has a knowledge base with ${totalClaims} claims extracted from ${totalSources} sources.

Your job is to answer the user's questions using ONLY the provided context from their knowledge base. Be specific and cite your sources.

RULES:
1. Ground every factual statement in the provided claims or source text
2. Use citations like [CLAIM 1], [SOURCE 2] etc. to reference specific evidence
3. If claims contradict each other, highlight the disagreement explicitly
4. If you cannot answer from the provided context, say so clearly and suggest what content the user could ingest to fill the gap
5. Note confidence levels when relevant — a claim at 60% confidence is less certain than one at 95%
6. Be conversational but precise
7. When multiple sources support the same point, mention all of them
8. If the user asks about something not in their knowledge base, be honest about it

KNOWLEDGE BASE CONTEXT:

=== EXTRACTED CLAIMS ===
${claimContext || "No matching claims found."}

=== SOURCE EXCERPTS ===
${sourceContext || "No matching source text found."}`;

  // Build messages array with history
  const messages: any[] = [];
  if (history && Array.isArray(history)) {
    for (const h of history.slice(-10)) { // Keep last 10 turns
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: "user", content: message });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    });

    const assistantMessage = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Return the response with metadata about what was found
    return NextResponse.json({
      success: true,
      data: {
        message: assistantMessage,
        context: {
          claimsFound: relevantClaims.length,
          sourcesFound: relevantSources.length,
          searchTerms,
          claims: relevantClaims.map((c: any) => ({
            id: c.id,
            text: c.text.slice(0, 100),
            status: c.status,
            confidence: c.confidence,
            sources: c.sources.map((s: any) => ({ title: s.source.title, author: s.source.author })),
          })),
          sources: relevantSources.map((s: any) => ({
            id: s.id,
            title: s.title,
            author: s.author,
            type: s.type,
          })),
        },
      },
    });
  } catch (error: any) {
    console.error("Chat error:", error);
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
]);
