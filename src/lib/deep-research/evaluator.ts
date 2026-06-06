// ============================================================
// Deep Research — Candidate evaluator (Phase 2)
//
// Scores a pool of search candidates against the user's ORIGINAL question in a
// single batched Claude call (not one call per candidate). Returns the pool
// sorted by a weighted blend of relevance and quality.
//
// Same lazy Anthropic client + robust JSON parsing pattern as planner.ts.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type { Candidate } from "./search";

const MODEL = "claude-sonnet-4-20250514";

// Abstracts can be long; cap each one so a large pool stays within a sane
// prompt size. ~1500 chars keeps the substance without blowing up tokens.
const MAX_ABSTRACT_CHARS = 1500;

// Weighted blend used for the final ranking. Relevance dominates — a rigorous
// paper that doesn't answer the question is worth less than a solid one that does.
const RELEVANCE_WEIGHT = 0.7;
const QUALITY_WEIGHT = 0.3;

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return anthropic;
}

export interface EvaluatedCandidate extends Candidate {
  relevanceScore: number;
  qualityScore: number;
  notes: string;
  /** relevanceScore * 0.7 + qualityScore * 0.3 — what the pool is sorted by. */
  combinedScore: number;
}

// --- Robust JSON parsing (mirrors ingest.ts / planner.ts) ---

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
    throw new Error(`Could not parse JSON from evaluator response: ${raw.slice(0, 200)}`);
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Score every candidate against the original research question in one call.
 *
 * Returns the candidates enriched with relevanceScore, qualityScore, notes, and
 * a precomputed combinedScore, sorted by combinedScore descending. If the model
 * omits a score for some candidate it defaults to 0 (so it sinks to the bottom)
 * rather than dropping the candidate.
 */
export async function evaluateCandidates(
  originalQuery: string,
  candidates: Candidate[],
): Promise<EvaluatedCandidate[]> {
  if (candidates.length === 0) return [];

  const list = candidates
    .map((c, i) => {
      const abstract = c.abstract.length > MAX_ABSTRACT_CHARS
        ? c.abstract.slice(0, MAX_ABSTRACT_CHARS) + "…"
        : c.abstract;
      return `[${i}] TITLE: ${c.title}
YEAR: ${c.year ?? "unknown"} | CITATIONS: ${c.citationCount ?? "unknown"}
ABSTRACT: ${abstract}`;
    })
    .join("\n\n");

  const prompt = `You are evaluating academic papers retrieved from Semantic Scholar for a deep research task.

ORIGINAL RESEARCH QUESTION:
"${originalQuery}"

For EACH candidate below, assign two scores from 0.0 to 1.0:

- relevanceScore: how directly the paper helps answer the ORIGINAL research question (1.0 = squarely on-topic and informative; 0.0 = unrelated).
- qualityScore: methodological strength and credibility. Weigh study design (RCT/meta-analysis > observational > case report/opinion), journal reputation, and citation count as a signal — but discount citation count for very recent papers (they haven't had time to accrue citations), and don't over-reward old highly-cited papers that may be outdated.

Also write "notes": a 1-2 sentence justification per candidate.

CANDIDATES:
${list}

Respond with ONLY valid JSON — no markdown, no prose — matching this exact structure:
{
  "evaluations": [
    { "index": 0, "relevanceScore": 0.0, "qualityScore": 0.0, "notes": "..." }
  ]
}
Include one object per candidate, referencing it by its [index].`;

  // Token budget scales loosely with pool size; cap so we never under-allocate
  // for a large pool but don't request absurd amounts.
  const maxTokens = Math.min(8192, 400 + candidates.length * 120);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") {
    throw new Error("evaluateCandidates: unexpected (non-text) response from model");
  }

  const parsed = parseJsonResponse(block.text);
  const evals: any[] = Array.isArray(parsed) ? parsed : parsed?.evaluations;
  if (!Array.isArray(evals)) {
    throw new Error("evaluateCandidates: model response missing `evaluations` array");
  }

  // Map scores back onto candidates by index; default to 0 for any the model skipped.
  const byIndex = new Map<number, any>();
  for (const e of evals) {
    if (e && Number.isInteger(e.index)) byIndex.set(e.index, e);
  }

  const evaluated: EvaluatedCandidate[] = candidates.map((c, i) => {
    const e = byIndex.get(i);
    const relevanceScore = clamp01(e?.relevanceScore);
    const qualityScore = clamp01(e?.qualityScore);
    return {
      ...c,
      relevanceScore,
      qualityScore,
      notes: typeof e?.notes === "string" ? e.notes.trim() : "",
      combinedScore: relevanceScore * RELEVANCE_WEIGHT + qualityScore * QUALITY_WEIGHT,
    };
  });

  evaluated.sort((a, b) => b.combinedScore - a.combinedScore);
  return evaluated;
}
