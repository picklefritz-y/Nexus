// ============================================================
// Deep Research — Watcher (Phase 4)
//
// Bridges the Vercel timeout gap: /api/deep-research/start only runs the
// planner (fast enough for a serverless function) and leaves the query in
// SEARCHING. This long-running process picks those up and drives
// search → evaluate → ingest (orchestrator), then report generation —
// minutes of work that can't live inside Vercel's 10s Hobby timeout.
//
// Usage:
//   npx tsx scripts/deep-research-watcher.ts
//
// Intended to run in a persistent tmux/screen session on the Mac mini.
// Polls the DB every 30s; processes one query at a time (no concurrency —
// keeps it simple and easy on API rate limits). On SIGINT/SIGTERM it
// finishes the in-flight query, then exits cleanly (signal again to force).
//
// Failures inside the orchestrator/reporter already mark the query FAILED
// with an errorMessage — the watcher just logs and moves on. Shares
// ingest.ts's Prisma client (single pool), same as the other CLIs.
//
// Built to run unattended: it connects with exponential-backoff retry at
// startup, and if several polls fail in a row (a wedged query engine after a
// Neon free-tier cold start, say) it cycles the connection and recovers
// without a manual restart.
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./ingest";
import { runDeepResearch } from "../src/lib/deep-research/orchestrator";
import { generateReport } from "../src/lib/deep-research/reporter";

const POLL_INTERVAL_MS = 30_000;

// Connection-retry tuning. Neon's free tier suspends after inactivity, so a
// cold start can refuse the first few connections for several seconds. Back
// off exponentially from 2s up to a 60s ceiling while it wakes.
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
// After this many consecutive poll failures, assume the long-lived Prisma
// query engine has wedged (the failure mode where a connection that dies
// during a cold start never heals) and force a disconnect + reconnect.
const RECONNECT_AFTER_FAILURES = 3;

let shuttingDown = false;
let wakeFromSleep: (() => void) | null = null;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Interruptible sleep so a shutdown signal during the idle wait (or a
// reconnect backoff) exits immediately instead of after the full delay.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { wakeFromSleep = null; resolve(); }, ms);
    wakeFromSleep = () => { clearTimeout(timer); wakeFromSleep = null; resolve(); };
  });
}

// Establish a working connection, retrying with exponential backoff until it
// succeeds or we're shutting down. Used both at startup (so a launch during a
// Neon cold start doesn't leave a wedged engine on the first query) and to
// recover mid-run. A fresh $connect() after $disconnect() spins up a new query
// engine, which is what actually clears the wedged-engine state.
async function connectWithRetry(label: string): Promise<boolean> {
  let delay = RECONNECT_BASE_MS;
  let attempt = 0;
  while (!shuttingDown) {
    attempt++;
    try {
      await prisma.$connect();
      // Prove the engine actually round-trips, not just that $connect resolved.
      await prisma.$queryRaw`SELECT 1`;
      if (attempt > 1) log(`[db] ${label}: connected after ${attempt} attempts`);
      return true;
    } catch (e: any) {
      log(`[db] ${label}: connect attempt ${attempt} failed — ${e?.message?.split("\n")[0] ?? e}; retrying in ${delay / 1000}s`);
      await sleep(delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }
  }
  return false;
}

async function processQuery(q: { id: string; originalQuery: string; status: string }): Promise<void> {
  log(`▶ query ${q.id} [${q.status}]: "${q.originalQuery}"`);
  try {
    // SEARCHING = freshly planned by /start → run the full orchestrator.
    // GENERATING = orchestrator already finished (e.g. the watcher was
    // restarted between phases) → skip straight to the report.
    if (q.status === "SEARCHING") {
      log(`  [orchestrate] search → evaluate → ingest`);
      await runDeepResearch(q.id);
    }

    const after = await prisma.deepResearchQuery.findUnique({
      where: { id: q.id },
      select: { status: true },
    });

    if (after?.status === "GENERATING") {
      log(`  [report] synthesizing cited report`);
      const result = await generateReport(q.id);
      log(`✔ query ${q.id} COMPLETE — ${result.sourceCount} sources, ${result.citationTotal} citations, ${result.markdown.length} chars`);
    } else {
      log(`✘ query ${q.id} ended in ${after?.status ?? "unknown"} — moving on`);
    }
  } catch (e: any) {
    // The orchestrator/reporter have already set status FAILED + errorMessage.
    log(`✘ query ${q.id} FAILED — ${e?.message ?? e}`);
  }
}

async function main(): Promise<void> {
  log(`deep-research watcher started — polling every ${POLL_INTERVAL_MS / 1000}s (Ctrl-C to stop)`);
  await connectWithRetry("startup");

  let consecutiveFailures = 0;
  while (!shuttingDown) {
    try {
      const next = await prisma.deepResearchQuery.findFirst({
        where: { status: { in: ["SEARCHING", "GENERATING"] } },
        orderBy: { createdAt: "asc" }, // oldest first
        select: { id: true, originalQuery: true, status: true },
      });
      consecutiveFailures = 0; // a clean poll means the connection is healthy
      if (next) {
        await processQuery(next);
        continue; // check for the next queued query immediately — no idle wait
      }
    } catch (e: any) {
      consecutiveFailures++;
      log(`poll error (${consecutiveFailures}): ${e?.message?.split("\n")[0] ?? e}`);
      // A few failures in a row are likely a wedged query engine (e.g. the
      // connection died during a Neon cold start and won't self-heal). Cycle
      // the client to spin up a fresh engine, then resume polling.
      if (consecutiveFailures >= RECONNECT_AFTER_FAILURES) {
        log(`[db] ${consecutiveFailures} consecutive failures — cycling the connection`);
        await prisma.$disconnect().catch(() => {});
        await connectWithRetry("reconnect");
        consecutiveFailures = 0;
        continue; // reconnect already waited; poll again right away
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log("watcher stopped");
}

function shutdown(signal: string): void {
  if (shuttingDown) {
    log(`${signal} again — forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  log(`${signal} received — exiting after the current query (signal again to force)`);
  wakeFromSleep?.(); // if idle, wake the loop so it exits now
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main()
  .catch((e: any) => {
    console.error(`[${new Date().toISOString()}] watcher crashed:`, e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
