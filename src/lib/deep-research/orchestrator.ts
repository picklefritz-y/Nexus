// ============================================================
// Deep Research — Orchestrator (Phase 2)
//
// Drives a planned query through: search → dedupe → evaluate → ingest.
// Phase 3 (report generation) picks up from the GENERATING status this leaves
// behind. Runs via CLI for now (scripts/run-deep-research.ts) — the API trigger
// path is a Phase 4 problem because of Vercel's 10s function timeout.
//
// Imports relative (not "@/") so this stays runnable under tsx, and reuses
// ingest.ts's Prisma client + ingestUrl so there's a single connection pool
// (the documented batch-runner pattern — see scripts/ingest.ts).
// ============================================================

import { prisma, MVP_USER_ID, ingestUrl } from "../../../scripts/ingest";
import { searchSemanticScholar, type Candidate } from "./search";
import { evaluateCandidates } from "./evaluator";

export interface RunOptions {
  topN?: number;
  candidatesPerSubquery?: number;
}

// Canonicalize a URL for dedup (within the run and against existing Sources):
// DOIs collapse to https://doi.org/<doi>, everything else lowercases host and
// strips a trailing slash. DOIs are matched case-insensitively (lowercased).
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const doiMatch = trimmed.match(/10\.\d{4,9}\/[^\s"<>]+/);
  if (doiMatch) {
    return `https://doi.org/${doiMatch[0].toLowerCase().replace(/\/+$/, "")}`;
  }
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

function appendNote(existing: string | null, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

/**
 * Run the search → evaluate → ingest pipeline for a planned query.
 *
 * Progress is reflected in the DB as it goes (status transitions + per-candidate
 * decisions), so a partial run is still inspectable. Each candidate's ingestion
 * is isolated in its own try/catch — one failure never aborts the run. Any
 * unexpected error marks the query FAILED (and is re-thrown for the CLI).
 */
export async function runDeepResearch(
  queryId: string,
  options: RunOptions = {},
): Promise<void> {
  const topN = options.topN ?? 5;
  const candidatesPerSubquery = options.candidatesPerSubquery ?? 15;

  const query = await prisma.deepResearchQuery.findUnique({
    where: { id: queryId },
    include: { subqueries: { orderBy: { order: "asc" } } },
  });
  if (!query) throw new Error(`DeepResearchQuery ${queryId} not found`);

  try {
    console.log(`[deep-research] query ${query.id}: "${query.originalQuery}"`);
    console.log(
      `[deep-research] ${query.subqueries.length} subqueries | topN=${topN} | perSubquery=${candidatesPerSubquery}`,
    );

    // Idempotent re-run: drop candidates from any previous run of this query.
    await prisma.deepResearchCandidate.deleteMany({ where: { queryId: query.id } });

    // --- SEARCH ---
    await prisma.deepResearchQuery.update({
      where: { id: query.id },
      data: { status: "SEARCHING" },
    });

    // Dedupe within the run by normalized URL; first subquery to surface a paper
    // owns it (records which subquery found it).
    const deduped = new Map<string, { candidate: Candidate; subqueryId: string }>();
    let totalHits = 0;
    for (let i = 0; i < query.subqueries.length; i++) {
      const sq = query.subqueries[i];
      const hits = await searchSemanticScholar(sq.text, candidatesPerSubquery);
      totalHits += hits.length;
      let added = 0;
      for (const c of hits) {
        const normalizedUrl = normalizeUrl(c.url);
        if (deduped.has(normalizedUrl)) continue;
        deduped.set(normalizedUrl, {
          candidate: { ...c, url: normalizedUrl },
          subqueryId: sq.id,
        });
        added++;
      }
      console.log(
        `[search] subquery ${i + 1}/${query.subqueries.length} "${sq.text}" → ${hits.length} hits (${added} new)`,
      );
    }

    const pool = [...deduped.values()];
    console.log(
      `[search] ${totalHits} hits across subqueries → ${pool.length} unique candidates`,
    );

    if (pool.length > 0) {
      await prisma.deepResearchCandidate.createMany({
        data: pool.map((p) => ({
          queryId: query.id,
          subqueryId: p.subqueryId,
          url: p.candidate.url,
          title: p.candidate.title,
          abstract: p.candidate.abstract,
          year: p.candidate.year,
          citationCount: p.candidate.citationCount,
          source: p.candidate.source,
          decision: "PENDING",
        })),
      });
    }

    // Re-read so we have row ids keyed by (normalized) URL.
    const rows = await prisma.deepResearchCandidate.findMany({
      where: { queryId: query.id },
    });
    const rowByUrl = new Map(rows.map((r) => [r.url, r]));

    if (pool.length === 0) {
      await prisma.deepResearchQuery.update({
        where: { id: query.id },
        data: { status: "GENERATING" },
      });
      console.log(`[done] no candidates found; status → GENERATING`);
      return;
    }

    // --- EVALUATE ---
    await prisma.deepResearchQuery.update({
      where: { id: query.id },
      data: { status: "EVALUATING" },
    });
    console.log(`[evaluate] scoring ${pool.length} candidates...`);
    const evaluated = await evaluateCandidates(
      query.originalQuery,
      pool.map((p) => p.candidate),
    );

    // Persist scores; top N by combinedScore → INGEST, the rest → SKIP.
    for (let rank = 0; rank < evaluated.length; rank++) {
      const ec = evaluated[rank];
      const row = rowByUrl.get(ec.url);
      if (!row) continue;
      await prisma.deepResearchCandidate.update({
        where: { id: row.id },
        data: {
          relevanceScore: ec.relevanceScore,
          qualityScore: ec.qualityScore,
          evaluatorNotes: ec.notes,
          decision: rank < topN ? "INGEST" : "SKIP",
        },
      });
    }
    const toIngest = evaluated.slice(0, topN);
    console.log(`[evaluate] selected top ${toIngest.length} for ingestion`);

    // --- INGEST ---
    await prisma.deepResearchQuery.update({
      where: { id: query.id },
      data: { status: "INGESTING" },
    });

    // Map existing Sources by normalized URL so we can flag duplicates no matter
    // how the existing source's URL happens to be stored.
    const existingSources = await prisma.source.findMany({
      where: { userId: MVP_USER_ID },
      select: { id: true, url: true },
    });
    const sourceByUrl = new Map<string, string>();
    for (const s of existingSources) {
      if (s.url) sourceByUrl.set(normalizeUrl(s.url), s.id);
    }

    let ingested = 0;
    let duplicates = 0;
    let failed = 0;
    for (const ec of toIngest) {
      const row = rowByUrl.get(ec.url);
      if (!row) continue;

      try {
        // ec.url is already normalized; sourceByUrl keys are normalized too.
        const existingId = sourceByUrl.get(ec.url);
        if (existingId) {
          await prisma.deepResearchCandidate.update({
            where: { id: row.id },
            data: { decision: "DUPLICATE", ingestedSourceId: existingId },
          });
          duplicates++;
          console.log(`[ingest] DUPLICATE  ${ec.title.slice(0, 70)}`);
          continue;
        }

        const result = await ingestUrl(ec.url);
        if (result.status === "success" && result.sourceId) {
          await prisma.deepResearchCandidate.update({
            where: { id: row.id },
            data: { ingestedSourceId: result.sourceId }, // decision stays INGEST
          });
          // A later candidate could dedupe against this freshly-ingested source.
          sourceByUrl.set(ec.url, result.sourceId);
          ingested++;
          console.log(`[ingest] OK         ${ec.title.slice(0, 70)}`);
        } else {
          const note = `Ingestion ${result.status}: ${result.error ?? "no source id returned"}`;
          await prisma.deepResearchCandidate.update({
            where: { id: row.id },
            data: { decision: "SKIP", evaluatorNotes: appendNote(row.evaluatorNotes, note) },
          });
          failed++;
          console.log(
            `[ingest] FAILED     ${ec.title.slice(0, 70)} — ${result.error ?? result.status}`,
          );
        }
      } catch (e: any) {
        await prisma.deepResearchCandidate
          .update({
            where: { id: row.id },
            data: {
              decision: "SKIP",
              evaluatorNotes: appendNote(row.evaluatorNotes, `Ingestion threw: ${e.message}`),
            },
          })
          .catch(() => {});
        failed++;
        console.log(`[ingest] ERROR      ${ec.title.slice(0, 70)} — ${e.message}`);
      }
    }

    // --- DONE — Phase 3 (report generation) picks up from GENERATING ---
    await prisma.deepResearchQuery.update({
      where: { id: query.id },
      data: { status: "GENERATING" },
    });
    console.log(
      `[done] ingested=${ingested} duplicates=${duplicates} failed=${failed} | status → GENERATING`,
    );
  } catch (error: any) {
    await prisma.deepResearchQuery
      .update({
        where: { id: queryId },
        data: { status: "FAILED", errorMessage: error?.message ?? "Unknown error" },
      })
      .catch(() => {});
    console.error("[deep-research] FAILED:", error);
    throw error;
  }
}
