// ============================================================
// Bulk Ingestion Runner
//
// Wraps scripts/ingest.ts (ingestUrl) to ingest many URLs sequentially,
// with duplicate-skipping, rate-limit pacing, and a re-runnable failure log.
//
// Usage:
//   npx tsx scripts/ingest-batch.ts urls.txt
//   npx tsx scripts/ingest-batch.ts "https://doi.org/..." "https://youtube.com/..."
//   cat urls.txt | npx tsx scripts/ingest-batch.ts -
//   npx tsx scripts/ingest-batch.ts urls.txt --dry-run
//
// Flags:
//   --dry-run            Parse + validate URLs and print the plan; ingest nothing.
//   --skip-existing      Skip URLs already ingested for user_mvp (default: on).
//   --no-skip-existing   Process every URL even if it's a duplicate.
//   --delay <ms>         Pause between URLs to avoid rate-limiting (default: 2000).
//
// Input file / stdin format: one URL per line. Blank lines are ignored and
// lines starting with `#` are treated as comments.
// ============================================================

import * as fs from "fs";
import * as path from "path";
import { ingestUrl, prisma, MVP_USER_ID, detectType } from "./ingest";

// --- ANSI colors (no dependency; honors NO_COLOR) ---

const useColor = !process.env.NO_COLOR && process.stdout.isTTY !== false;
const color = (code: string, s: string) => (useColor ? `${code}${s}\x1b[0m` : s);
const green = (s: string) => color("\x1b[32m", s);
const yellow = (s: string) => color("\x1b[33m", s);
const red = (s: string) => color("\x1b[31m", s);
const cyan = (s: string) => color("\x1b[36m", s);
const dim = (s: string) => color("\x1b[2m", s);
const bold = (s: string) => color("\x1b[1m", s);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Arg parsing ---

interface BatchArgs {
  positionals: string[];
  dryRun: boolean;
  skipExisting: boolean;
  delayMs: number;
}

function parseArgs(argv: string[]): BatchArgs {
  const positionals: string[] = [];
  let dryRun = false;
  let skipExisting = true;
  let delayMs = 2000;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--skip-existing") {
      skipExisting = true;
    } else if (a === "--no-skip-existing") {
      skipExisting = false;
    } else if (a === "--delay") {
      delayMs = parseDelay(argv[++i]);
    } else if (a.startsWith("--delay=")) {
      delayMs = parseDelay(a.slice("--delay=".length));
    } else if (a.startsWith("--")) {
      console.error(red(`Unknown flag: ${a}`));
      process.exit(1);
    } else {
      positionals.push(a);
    }
  }

  return { positionals, dryRun, skipExisting, delayMs };
}

function parseDelay(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isFinite(n) || n < 0) {
    console.error(red(`Invalid --delay value: ${raw ?? "(missing)"} (expected a non-negative number of ms)`));
    process.exit(1);
  }
  return n;
}

// --- URL list parsing ---

function parseUrlLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || s.startsWith("10."); // http(s) or bare DOI
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/**
 * Turn positional args into the final, de-duplicated list of URLs to process.
 * Three modes: stdin ("-"), a single file path, or a literal list of URLs.
 */
async function resolveUrls(args: BatchArgs): Promise<string[]> {
  // stdin mode
  if (args.positionals.length === 1 && args.positionals[0] === "-") {
    return dedupe(parseUrlLines(await readStdin()));
  }

  // file mode: a single positional that isn't itself a URL
  if (args.positionals.length === 1 && !looksLikeUrl(args.positionals[0])) {
    const file = args.positionals[0];
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      console.error(red(`File not found: ${file}`));
      console.error(dim("(Pass a .txt file with one URL per line, a list of URLs, or - for stdin.)"));
      process.exit(1);
    }
    return dedupe(parseUrlLines(fs.readFileSync(file, "utf-8")));
  }

  // URL-list mode: every positional is a URL (still drop blanks/comments + dedupe)
  return dedupe(parseUrlLines(args.positionals.join("\n")));
}

// --- Validation (used by --dry-run) ---

function validateUrl(u: string): { ok: boolean; reason?: string } {
  if (u.startsWith("10.")) return { ok: true }; // bare DOI
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: `unsupported protocol "${parsed.protocol}"` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
}

async function alreadyIngested(url: string): Promise<string | null> {
  const existing = await prisma.source.findFirst({
    where: { url, userId: MVP_USER_ID },
    select: { id: true },
  });
  return existing?.id ?? null;
}

// --- Usage ---

function printUsage() {
  console.log(`
${bold("Bulk ingestion runner")} — ingest many URLs through scripts/ingest.ts

${bold("Usage:")}
  npx tsx scripts/ingest-batch.ts urls.txt
  npx tsx scripts/ingest-batch.ts "https://doi.org/..." "https://youtube.com/..."
  cat urls.txt | npx tsx scripts/ingest-batch.ts -
  npx tsx scripts/ingest-batch.ts urls.txt --dry-run

${bold("Flags:")}
  --dry-run            Validate URLs and print the plan; ingest nothing.
  --skip-existing      Skip URLs already ingested for ${MVP_USER_ID} (default: on).
  --no-skip-existing   Process every URL even if it's a duplicate.
  --delay <ms>         Pause between URLs (default: 2000).

Input file / stdin: one URL per line; blank lines ignored, lines starting with # are comments.
`);
}

// --- Dry run ---

async function runDryRun(urls: string[], args: BatchArgs) {
  console.log("\n" + "═".repeat(60));
  console.log(`  ${bold("DRY RUN")} — ${urls.length} URL(s), nothing will be ingested`);
  console.log(`  skip-existing: ${args.skipExisting ? "on" : "off"}   delay: ${args.delayMs}ms`);
  console.log("═".repeat(60) + "\n");

  let wouldIngest = 0;
  let wouldSkip = 0;
  let invalid = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const idx = dim(`[${i + 1}/${urls.length}]`);
    const valid = validateUrl(url);

    if (!valid.ok) {
      invalid++;
      console.log(`${idx} ${red("✗ invalid")} ${url} ${dim(`(${valid.reason})`)}`);
      continue;
    }

    const type = detectType(url);
    let existingId: string | null = null;
    if (args.skipExisting) {
      try {
        existingId = await alreadyIngested(url);
      } catch (err: any) {
        console.log(`${idx} ${yellow("⚠ db check failed")} ${url} ${dim(`(${err?.message ?? err})`)}`);
      }
    }

    if (existingId) {
      wouldSkip++;
      console.log(`${idx} ${yellow("⊘ would skip")} ${dim(`[${type}]`)} ${url} ${dim(`(source ${existingId})`)}`);
    } else {
      wouldIngest++;
      console.log(`${idx} ${green("✓ would ingest")} ${dim(`[${type}]`)} ${url}`);
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`  Would ingest: ${wouldIngest}   Would skip: ${wouldSkip}   Invalid: ${invalid}`);
  console.log("─".repeat(60) + "\n");
}

// --- Real run ---

async function runBatch(urls: string[], args: BatchArgs) {
  const start = Date.now();
  const counts = { success: 0, skipped: 0, failed: 0 };
  const failedUrls: string[] = [];

  console.log("\n" + "═".repeat(60));
  console.log(`  ${bold("🔮 NEXUS — Batch Ingestion")} — ${urls.length} URL(s)`);
  console.log(`  skip-existing: ${args.skipExisting ? "on" : "off"}   delay: ${args.delayMs}ms`);
  console.log("═".repeat(60));

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n${cyan(`[${i + 1}/${urls.length}]`)} Processing: ${url}`);

    try {
      // Skip duplicates before spending a full fetch + Claude pipeline on them.
      if (args.skipExisting) {
        const existingId = await alreadyIngested(url);
        if (existingId) {
          counts.skipped++;
          console.log(`  ${yellow("⊘ skipped")} — already ingested ${dim(`(source ${existingId})`)}`);
          continue; // intentionally skips the --delay sleep: no network call was made
        }
      }

      const result = await ingestUrl(url);

      if (result.status === "success") {
        counts.success++;
        console.log(`  ${green("✓ success")} — ${result.title ?? "(untitled)"} ${dim(`[${result.sourceId}]`)}`);
      } else {
        counts.failed++;
        failedUrls.push(url);
        console.log(`  ${red("✗ failed")} — ${result.error ?? "unknown error"}`);
      }
    } catch (err: any) {
      // Belt-and-suspenders: ingestUrl shouldn't throw, but never let one URL
      // (or a DB skip-check error) abort the whole batch.
      counts.failed++;
      failedUrls.push(url);
      console.log(`  ${red("✗ failed")} — ${err?.message ?? String(err)}`);
    }

    // Pace requests to avoid rate-limiting Semantic Scholar / AssemblyAI.
    if (i < urls.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  printSummary(urls.length, counts, start, failedUrls);
  return counts;
}

function printSummary(
  total: number,
  counts: { success: number; skipped: number; failed: number },
  startMs: number,
  failedUrls: string[],
) {
  const elapsedSec = (Date.now() - startMs) / 1000;
  const elapsed =
    elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)}m ${Math.round(elapsedSec % 60)}s`
      : `${elapsedSec.toFixed(1)}s`;

  console.log("\n" + "═".repeat(60));
  console.log(`  ${bold("BATCH COMPLETE")}`);
  console.log("═".repeat(60));
  console.log(`  Total:      ${total}`);
  console.log(`  ${green(`Succeeded:  ${counts.success}`)}`);
  console.log(`  ${yellow(`Skipped:    ${counts.skipped}`)}`);
  console.log(`  ${counts.failed > 0 ? red(`Failed:     ${counts.failed}`) : `Failed:     0`}`);
  console.log(`  Elapsed:    ${elapsed}`);
  console.log("═".repeat(60));

  if (failedUrls.length > 0) {
    // Sanitize ISO timestamp for use in a filename (drop colons / dots).
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.join(process.cwd(), `failed-batch-${stamp}.txt`);
    fs.writeFileSync(outPath, failedUrls.join("\n") + "\n");
    console.log(`\n  ${red(`${failedUrls.length} URL(s) failed.`)} Written to:`);
    console.log(`    ${path.basename(outPath)}`);
    console.log(`  Re-run just the failures with:`);
    console.log(`    npx tsx scripts/ingest-batch.ts ${path.basename(outPath)}`);
    console.log("");
  }
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.positionals.length === 0) {
    printUsage();
    process.exit(1);
  }

  const urls = await resolveUrls(args);
  if (urls.length === 0) {
    console.error(red("No URLs to process (input was empty after stripping blanks/comments)."));
    process.exit(1);
  }

  try {
    if (args.dryRun) {
      await runDryRun(urls, args);
      return;
    }

    const counts = await runBatch(urls, args);
    if (counts.failed > 0) process.exitCode = 1; // non-zero exit if anything failed
  } finally {
    await prisma.$disconnect();
  }
}

main();
