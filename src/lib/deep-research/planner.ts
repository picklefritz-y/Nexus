// ============================================================
// Deep Research — Planner
// Decomposes a broad research question into focused sub-queries
// optimised for Semantic Scholar search.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";

// Lazy singleton: constructed on first use, not at import time. The Anthropic
// SDK reads ANTHROPIC_API_KEY in its constructor and throws if it's missing, so
// eager construction would blow up when this module is imported before a
// caller's dotenv.config() has run (ES imports are hoisted above the module
// body — see scripts/test-deep-research-planner.ts).
let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return anthropic;
}

// --- Robust JSON parsing (mirrors ingest.ts) ---

function extractBalancedJson(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonResponse(raw: string): any {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    if (start !== -1) {
      const candidate = extractBalancedJson(text, start);
      if (candidate) return JSON.parse(candidate);
    }
    throw new Error(
      `Could not parse JSON from planner response: ${raw.slice(0, 200)}`
    );
  }
}

// --- Types ---

export interface Subquery {
  text: string;
  rationale: string;
}

export interface PlannerResult {
  subqueries: Subquery[];
}

// --- Main export ---

export async function planResearch(
  originalQuery: string
): Promise<PlannerResult> {
  const prompt = `You are a research planning assistant for a knowledge engine that searches Semantic Scholar (an academic paper database).

Your task: decompose the following research question into 3–6 focused sub-queries that together give comprehensive coverage of the topic.

RESEARCH QUESTION: "${originalQuery}"

Requirements for each sub-query:
- Optimised for keyword-based academic search (avoid question phrasing; use noun phrases and key terms)
- Covers a distinct angle or sub-topic (mechanisms, clinical evidence, historical context, comparative studies, etc.)
- Specific enough to return high-signal results on Semantic Scholar
- Each rationale explains in one sentence why this angle matters for answering the original question

Respond with ONLY a valid JSON object matching this exact structure — no markdown fences, no prose:
{
  "subqueries": [
    { "text": "<search query>", "rationale": "<one-sentence rationale>" },
    ...
  ]
}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from planner model");
  }

  const result = parseJsonResponse(block.text) as PlannerResult;

  if (!result.subqueries || !Array.isArray(result.subqueries)) {
    throw new Error(
      "Planner response missing `subqueries` array"
    );
  }

  // Normalise: ensure every entry has the required fields
  result.subqueries = result.subqueries
    .filter((sq) => sq && typeof sq.text === "string" && sq.text.trim())
    .map((sq) => ({
      text: sq.text.trim(),
      rationale: (sq.rationale ?? "").trim(),
    }));

  if (result.subqueries.length === 0) {
    throw new Error("Planner returned zero valid sub-queries");
  }

  return result;
}
