// ============================================================
// Deep Research — Report generator CLI (Phase 3)
//
// Usage:
//   npx tsx scripts/generate-report.ts <queryId>
//
// Generates the cited markdown report for a query the orchestrator left in
// GENERATING (or regenerates a COMPLETE one), then prints it. Shares
// ingest.ts's Prisma client (single pool).
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./ingest";
import { generateReport } from "../src/lib/deep-research/reporter";

async function main() {
  const queryId = process.argv[2];

  if (!queryId) {
    console.error("\nUsage: npx tsx scripts/generate-report.ts <queryId>\n");
    process.exit(1);
  }

  console.log("\n" + "═".repeat(64));
  console.log("  📝 Deep Research — Report Generator");
  console.log("═".repeat(64) + "\n");

  const result = await generateReport(queryId);

  console.log("\n" + "─".repeat(64));
  console.log("  SUMMARY");
  console.log("─".repeat(64));
  console.log(`  Report id:          ${result.reportId}`);
  console.log(`  Sources cited:      ${result.sourceCount}`);
  console.log(`  Inline citations:   ${result.citationTotal}`);
  console.log(`  Length:             ${result.markdown.length} chars`);

  console.log("\n" + "─".repeat(64));
  console.log("  REPORT");
  console.log("─".repeat(64) + "\n");
  console.log(result.markdown);
  console.log("═".repeat(64) + "\n");
}

main()
  .catch((e: any) => {
    console.error("\n❌ Report generator error:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
