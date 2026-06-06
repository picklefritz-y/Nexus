// ============================================================
// CLI test for the Deep Research planner — no database involved.
// Usage: npx tsx scripts/test-deep-research-planner.ts "your query"
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import { planResearch } from "../src/lib/deep-research/planner";

const query = process.argv[2];

if (!query) {
  console.error(
    '\nUsage: npx tsx scripts/test-deep-research-planner.ts "your research question"\n'
  );
  process.exit(1);
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  🔬 Deep Research Planner — Test");
  console.log("═".repeat(60));
  console.log(`\n  Query: "${query}"\n`);

  const result = await planResearch(query);

  console.log(`  ${result.subqueries.length} sub-queries generated:\n`);
  result.subqueries.forEach((sq, i) => {
    console.log(`  ${i + 1}. ${sq.text}`);
    console.log(`     → ${sq.rationale}`);
    console.log();
  });

  console.log("─".repeat(60));
  console.log("\n  Raw JSON output:\n");
  console.log(JSON.stringify(result, null, 2));
  console.log();
}

main().catch((e: Error) => {
  console.error("\n❌ Planner error:", e.message);
  process.exit(1);
});
