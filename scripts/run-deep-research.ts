// ============================================================
// Deep Research — Orchestrator CLI (Phase 2)
//
// Usage:
//   npx tsx scripts/run-deep-research.ts <queryId> [--top-n N] [--candidates-per-subquery N]
//
// Runs search → evaluate → ingest for an already-planned query (create one
// first with scripts/test-deep-research-planner.ts or POST /api/deep-research/start),
// then prints a summary. Shares ingest.ts's Prisma client (single pool).
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./ingest";
import { runDeepResearch } from "../src/lib/deep-research/orchestrator";

function parseFlag(args: string[], name: string): number | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) {
    const n = Number(args[idx + 1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const queryId = args.find((a) => !a.startsWith("--"));

  if (!queryId) {
    console.error(
      "\nUsage: npx tsx scripts/run-deep-research.ts <queryId> [--top-n N] [--candidates-per-subquery N]\n",
    );
    process.exit(1);
  }

  const topN = parseFlag(args, "--top-n");
  const candidatesPerSubquery = parseFlag(args, "--candidates-per-subquery");

  console.log("\n" + "═".repeat(64));
  console.log("  🔬 Deep Research — Orchestrator");
  console.log("═".repeat(64) + "\n");

  await runDeepResearch(queryId, { topN, candidatesPerSubquery });

  // --- Summary from the DB ---
  const [q, candidates] = await Promise.all([
    prisma.deepResearchQuery.findUnique({ where: { id: queryId } }),
    prisma.deepResearchCandidate.findMany({ where: { queryId } }),
  ]);

  const count = (decision: string) =>
    candidates.filter((c) => c.decision === decision).length;
  const evaluated = candidates.filter((c) => c.relevanceScore !== null);

  console.log("\n" + "─".repeat(64));
  console.log("  SUMMARY");
  console.log("─".repeat(64));
  console.log(`  Query status:          ${q?.status}`);
  console.log(`  Searched (unique):     ${candidates.length}`);
  console.log(`  Evaluated:             ${evaluated.length}`);
  console.log(`  Ingested:              ${count("INGEST")}`);
  console.log(`  Duplicates:            ${count("DUPLICATE")}`);
  console.log(`  Skipped:               ${count("SKIP")}`);
  if (count("PENDING")) console.log(`  Pending (unexpected):  ${count("PENDING")}`);

  const scored = evaluated
    .map((c) => ({
      ...c,
      combined: c.relevanceScore! * 0.7 + (c.qualityScore ?? 0) * 0.3,
    }))
    .sort((a, b) => b.combined - a.combined);

  console.log("\n  Top 5 by combined score:\n");
  scored.slice(0, 5).forEach((c, i) => {
    console.log(
      `  ${i + 1}. [${c.combined.toFixed(3)}]  rel=${c.relevanceScore?.toFixed(2)} qual=${c.qualityScore?.toFixed(2)}  →  ${c.decision}`,
    );
    console.log(`     ${c.title.slice(0, 92)}`);
    console.log(`     ${c.url}`);
    if (c.evaluatorNotes) {
      console.log(`     ⮑ ${c.evaluatorNotes.replace(/\s+/g, " ").slice(0, 150)}`);
    }
    console.log();
  });
  console.log("═".repeat(64) + "\n");
}

main()
  .catch((e: any) => {
    console.error("\n❌ Orchestrator error:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
