// ============================================================
// Deep Research — Semantic Scholar search (Phase 2)
//
// Turns one sub-query string into a list of paper candidates. Mirrors the
// Semantic Scholar fetch pattern in scripts/ingest.ts (plain fetch + `fields`
// param) — there is no shared S2 fetcher lib, ingest.ts only does single-paper
// lookups, so the *search* endpoint is implemented here.
//
// Web search is deliberately out of scope for this phase (S2 only).
// ============================================================

const S2_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const S2_FIELDS = "title,abstract,year,citationCount,externalIds,url";

export interface Candidate {
  /** DOI URL when available, else the Semantic Scholar paper URL. */
  url: string;
  title: string;
  /** Always present — candidates without an abstract are filtered out. */
  abstract: string;
  year: number | null;
  citationCount: number | null;
  source: "semantic-scholar";
}

// Raw shape of a Semantic Scholar search result row (only the fields we ask for).
interface S2Paper {
  paperId: string;
  title: string | null;
  abstract: string | null;
  year: number | null;
  citationCount: number | null;
  externalIds: { DOI?: string; ArXiv?: string } | null;
  url: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Build the canonical URL for a paper: prefer the DOI (what the ingest pipeline
// resolves best via Semantic Scholar metadata), fall back to the S2 page URL,
// finally synthesize one from the paperId.
function candidateUrl(p: S2Paper): string {
  const doi = p.externalIds?.DOI;
  if (doi) return `https://doi.org/${doi}`;
  if (p.url) return p.url;
  return `https://www.semanticscholar.org/paper/${p.paperId}`;
}

/**
 * Search Semantic Scholar for papers matching a sub-query.
 *
 * Retries on rate limiting (429) and transient 5xx with exponential backoff,
 * honoring `Retry-After` when present. On persistent failure it logs and
 * returns an empty array so the orchestrator can continue with other
 * sub-queries rather than aborting the whole run.
 *
 * Candidates with no abstract are dropped — the evaluator needs the abstract
 * to score relevance/quality.
 */
export async function searchSemanticScholar(
  subquery: string,
  limit = 20,
): Promise<Candidate[]> {
  const query = subquery.trim();
  if (!query) return [];

  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: S2_FIELDS,
  });
  const url = `${S2_SEARCH_URL}?${params.toString()}`;

  // Semantic Scholar works without a key but with much stricter rate limits.
  // Only send x-api-key if it looks like a real key (the .env placeholder is
  // a couple of chars; sending that would earn a 403).
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && apiKey.trim().length > 8) headers["x-api-key"] = apiKey.trim();

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers });

      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxAttempts) {
          console.warn(
            `[search] Semantic Scholar ${res.status} after ${maxAttempts} attempts for "${query}" — skipping`,
          );
          return [];
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
        console.warn(
          `[search] Semantic Scholar ${res.status} for "${query}" — retry ${attempt}/${maxAttempts - 1} in ${backoff}ms`,
        );
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        console.warn(`[search] Semantic Scholar ${res.status} for "${query}" — skipping`);
        return [];
      }

      const json = (await res.json()) as { data?: S2Paper[] };
      const data = json.data ?? [];

      return data
        .filter((p) => p && p.title && p.abstract && p.abstract.trim())
        .map((p) => ({
          url: candidateUrl(p),
          title: p.title!.trim(),
          abstract: p.abstract!.trim(),
          year: p.year ?? null,
          citationCount: p.citationCount ?? null,
          source: "semantic-scholar" as const,
        }));
    } catch (e: any) {
      // Network-level failure — back off and retry.
      if (attempt === maxAttempts) {
        console.warn(`[search] Network error for "${query}": ${e.message} — skipping`);
        return [];
      }
      await sleep(2 ** attempt * 1000);
    }
  }

  return [];
}
