// ============================================================
// Deep Research — Report generator (Phase 3)
//
// Picks up a query the orchestrator left in GENERATING and synthesizes a
// cited markdown report from the sources that run ingested (or flagged as
// duplicates of existing Sources). Cites the *extracted claims* in the
// knowledge base — not raw abstracts — and surfaces contradictions between
// them, since that's the whole point of Nexus.
//
// One Claude call produces the report body with inline [n] citations; the
// "## Sources" section is appended deterministically in code so reference
// numbering can never drift from the DB rows. Same lazy Anthropic client
// pattern as planner.ts / evaluator.ts.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../../scripts/ingest";

const MODEL = "claude-sonnet-4-20250514";

// Frames the synthesis as academic literature-review work. Nexus is an internal
// knowledge-management tool at AJNA BioSciences, a clinical-stage company
// developing botanical drug candidates under the FDA's Botanical Drug
// Development pathway. The model's output here is a literature review built from
// claims already extracted from peer-reviewed papers — the same work a
// researcher does writing the background section of a manuscript or regulatory
// filing. Stated up front so a dense scientific payload reads as the academic
// synthesis it is, rather than tripping a content-policy false positive.
const SYSTEM_PROMPT = `You are a scientific literature synthesis assistant for a knowledge-management tool used internally at AJNA BioSciences, a clinical-stage biopharmaceutical company that develops botanical drug candidates under the FDA's Botanical Drug Development pathway.

Your task is academic literature review. You synthesize structured claims that have already been extracted from peer-reviewed scientific papers into a balanced, cited review of the published evidence — the same work a researcher performs when writing the background or literature-review section of a scientific manuscript or regulatory submission: organizing prior findings, weighing the strength of evidence, and surfacing where the literature agrees, disagrees, or is silent.

Work only from the extracted claims and source metadata provided. Attribute every statement to its source, represent the evidence accurately — including its uncertainty and any contradictions — and do not editorialize beyond what the claims support.`;

// Reports synthesize ~5 sources with dozens of claims; give the model room
// for a thorough write-up without letting a runaway response burn tokens.
const MAX_REPORT_TOKENS = 8192;

// Cap per-source claim count in the prompt. Sources average 5-15 claims, so
// this only trims pathological outliers.
const MAX_CLAIMS_PER_SOURCE = 20;

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return anthropic;
}

export interface ReportResult {
  reportId: string;
  markdown: string;
  sourceCount: number;
  /** Total inline [n] citations found in the generated body. */
  citationTotal: number;
}

interface ReportSourceData {
  sourceId: string;
  title: string;
  author: string | null;
  year: number | null;
  journal: string | null;
  url: string | null;
  summary: string | null;
  relevanceScore: number;
  claims: { id: string; text: string; status: string; confidence: number }[];
}

function parseYear(date: Date | null): number | null {
  return date ? new Date(date).getFullYear() : null;
}

// Count how many times each source is cited inline. Citations look like [3]
// or [1, 4]; both forms are counted per referenced index.
function countCitations(body: string, sourceCount: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const match of body.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of match[1].split(",")) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 1 && n <= sourceCount) {
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function formatSourceReference(s: ReportSourceData): string {
  const parts = [s.author, s.year ? String(s.year) : null, s.journal]
    .filter(Boolean)
    .join(", ");
  const meta = parts ? ` — ${parts}` : "";
  const link = s.url ? `\n   ${s.url}` : "";
  return `**${s.title}**${meta}${link}`;
}

/**
 * Generate the report for a query and mark it COMPLETE.
 *
 * Expects the query to be in GENERATING (a COMPLETE query may be re-run to
 * regenerate its report; any existing report is replaced). With no ingested
 * sources to draw on, the query is marked FAILED with an explanatory message
 * rather than fabricating an uncited report.
 */
export async function generateReport(queryId: string): Promise<ReportResult> {
  const query = await prisma.deepResearchQuery.findUnique({
    where: { id: queryId },
    include: { subqueries: { orderBy: { order: "asc" } } },
  });
  if (!query) throw new Error(`DeepResearchQuery ${queryId} not found`);
  if (query.status !== "GENERATING" && query.status !== "COMPLETE") {
    throw new Error(
      `Query is ${query.status} — run the orchestrator first (expected GENERATING, or COMPLETE to regenerate)`,
    );
  }

  try {
    console.log(`[report] query ${query.id}: "${query.originalQuery}"`);

    // --- GATHER ---
    // Every candidate that resolved to a Source row contributes: fresh INGESTs
    // and DUPLICATEs alike (a duplicate is still a relevant, already-known source).
    const candidates = await prisma.deepResearchCandidate.findMany({
      where: { queryId: query.id, ingestedSourceId: { not: null } },
      orderBy: { relevanceScore: "desc" },
    });

    if (candidates.length === 0) {
      const message = "No ingested sources to report on — the search/ingest phase produced nothing usable";
      await prisma.deepResearchQuery.update({
        where: { id: query.id },
        data: { status: "FAILED", errorMessage: message },
      });
      throw new Error(message);
    }

    const sources = await prisma.source.findMany({
      where: { id: { in: candidates.map((c) => c.ingestedSourceId!) } },
      include: {
        claims: { include: { claim: true } },
      },
    });
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    // Order sources by evaluator relevance (the candidate order) — citation [1]
    // should be the most relevant paper.
    const reportSources: ReportSourceData[] = [];
    for (const c of candidates) {
      const s = sourceById.get(c.ingestedSourceId!);
      if (!s) continue;
      if (reportSources.some((r) => r.sourceId === s.id)) continue; // two candidates → same Source
      reportSources.push({
        sourceId: s.id,
        title: s.title,
        author: s.author,
        year: c.year ?? parseYear(s.publicationDate),
        journal: s.journal,
        url: s.url,
        summary: s.summary,
        relevanceScore: c.relevanceScore ?? 0.5,
        claims: s.claims.slice(0, MAX_CLAIMS_PER_SOURCE).map((cs) => ({
          id: cs.claim.id,
          text: cs.claim.text,
          status: cs.claim.status,
          confidence: cs.claim.confidence,
        })),
      });
    }

    const claimIds = reportSources.flatMap((s) => s.claims.map((c) => c.id));
    const contradictions = await prisma.contradiction.findMany({
      where: {
        OR: [{ claimId: { in: claimIds } }, { contradictedId: { in: claimIds } }],
      },
      include: {
        claim: { select: { text: true } },
        contradicted: { select: { text: true } },
      },
    });

    console.log(
      `[report] ${reportSources.length} sources, ${claimIds.length} claims, ${contradictions.length} contradictions`,
    );

    // --- PROMPT ---
    // Build each source block from structured extracted claims + bibliographic
    // metadata only. We deliberately do NOT include the freeform AI `summary`
    // (nor raw text / abstracts, which live on Source.rawText and
    // DeepResearchCandidate.abstract and were never passed): the claims are
    // short, citation-anchored, confidence-scored statements, which is exactly
    // what the synthesis should reason over.
    const sourceBlocks = reportSources
      .map((s, i) => {
        const claimLines = s.claims
          .map((c) => `  - [${c.status}, confidence ${c.confidence.toFixed(2)}] ${c.text}`)
          .join("\n");
        return `[${i + 1}] ${s.title}
AUTHOR: ${s.author ?? "unknown"} | YEAR: ${s.year ?? "unknown"} | JOURNAL: ${s.journal ?? "unknown"}
EXTRACTED CLAIMS:
${claimLines || "  (none)"}`;
      })
      .join("\n\n");

    const contradictionBlock = contradictions.length
      ? contradictions
          .map(
            (c) =>
              `- "${c.claim.text}" CONTRADICTS "${c.contradicted.text}"${c.explanation ? ` — ${c.explanation}` : ""}`,
          )
          .join("\n")
      : "(none detected)";

    const angles = query.subqueries.map((sq) => `- ${sq.text}: ${sq.rationale}`).join("\n");

    const prompt = `You are writing a research report for a knowledge management system used by a psychedelics researcher. The report synthesizes claims that were extracted from academic papers into the researcher's knowledge base.

RESEARCH QUESTION:
"${query.originalQuery}"

RESEARCH ANGLES COVERED (from the search plan):
${angles}

SOURCES (cite by bracketed number, e.g. [1] or [2, 3]):
${sourceBlocks}

KNOWN CONTRADICTIONS BETWEEN CLAIMS:
${contradictionBlock}

Write a markdown research report that directly answers the research question. Requirements:

- Start with a "## Executive Summary" (3-5 sentences answering the question head-on).
- Organize the body into thematic "## " sections that synthesize ACROSS sources — do not summarize source-by-source.
- Every factual statement must carry an inline citation like [1] or [2, 3]. Use ONLY the source numbers above; never invent sources or cite anything not listed.
- Treat claim status and confidence as evidentiary weight: lean on CONSENSUS/SUPPORTED claims, present EMERGING claims as preliminary, and explicitly flag CONTESTED/CONTRADICTED ones.
- If contradictions are listed above, address them in a "## Conflicting Evidence" section rather than papering over them.
- End with a "## Open Questions" section: what the gathered sources do NOT answer about the research question.
- Do NOT include a sources/references/bibliography section — it is appended programmatically.
- Aim for roughly 800-1500 words. Dense and specific beats long and vague.`;

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_REPORT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new Error("generateReport: unexpected (non-text) response from model");
    }
    let body = block.text.trim();

    // Belt-and-braces: if the model added its own references section despite
    // instructions, drop it — ours is canonical.
    body = body.replace(/\n##+\s*(Sources|References|Bibliography)[\s\S]*$/i, "").trim();

    const citationCounts = countCitations(body, reportSources.length);

    const referencesSection = reportSources
      .map((s, i) => `${i + 1}. ${formatSourceReference(s)}`)
      .join("\n");
    const markdown = `${body}\n\n## Sources\n\n${referencesSection}\n`;

    // --- PERSIST ---
    // Replace any prior report (regeneration case); cascade clears its
    // report-source rows. Transactional so a half-written report never exists.
    const report = await prisma.$transaction(async (tx) => {
      await tx.deepResearchReport.deleteMany({ where: { queryId: query.id } });
      const created = await tx.deepResearchReport.create({
        data: {
          queryId: query.id,
          markdown,
          sources: {
            create: reportSources.map((s, i) => ({
              sourceId: s.sourceId,
              relevanceScore: s.relevanceScore,
              citationCount: citationCounts.get(i + 1) ?? 0,
            })),
          },
        },
      });
      await tx.deepResearchQuery.update({
        where: { id: query.id },
        data: { status: "COMPLETE", completedAt: new Date(), errorMessage: null },
      });
      return created;
    });

    const citationTotal = [...citationCounts.values()].reduce((a, b) => a + b, 0);
    console.log(
      `[report] done — ${markdown.length} chars, ${citationTotal} inline citations | status → COMPLETE`,
    );

    return {
      reportId: report.id,
      markdown,
      sourceCount: reportSources.length,
      citationTotal,
    };
  } catch (error: any) {
    // Leave the query inspectable on failure; the no-sources path above has
    // already set FAILED with a more specific message.
    if (!error?.message?.startsWith("No ingested sources")) {
      await prisma.deepResearchQuery
        .update({
          where: { id: queryId },
          data: { status: "FAILED", errorMessage: error?.message ?? "Unknown error" },
        })
        .catch(() => {});
    }
    console.error("[report] FAILED:", error);
    throw error;
  }
}
