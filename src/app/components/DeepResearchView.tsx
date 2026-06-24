"use client";

// ============================================================
// Deep Research View (Phase 4)
//
// Submit a research question → POST /api/deep-research/start (planner only,
// fast enough for Vercel) → poll /api/deep-research/[id] every 3s while the
// watcher (scripts/deep-research-watcher.ts) drives search → evaluate →
// ingest → report on the Mac mini. Past queries hydrate from
// /api/deep-research/list.
//
// Rendered as a view inside NexusApp (the SPA owns the sidebar/chrome);
// citation clicks hand the cited sourceId back up via onOpenSource so the
// Library detail panel opens in-app.
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const POLL_MS = 3000;

const IN_PROGRESS = ["PLANNING", "SEARCHING", "EVALUATING", "INGESTING", "GENERATING"];

// Status → badge color + human phase line. SEARCHING doubles as "waiting for
// the watcher" since /start leaves queries there until the watcher picks them up.
const DR_STATUS: Record<string, { color: string; phase: string }> = {
  PLANNING: { color: "#b388ff", phase: "Decomposing the question into focused sub-queries..." },
  SEARCHING: { color: "#00e5ff", phase: "Searching Semantic Scholar across the sub-queries..." },
  EVALUATING: { color: "#ffd600", phase: "Scoring candidate papers for relevance and quality..." },
  INGESTING: { color: "#ff9100", phase: "Ingesting top papers — extracting claims into your knowledge base..." },
  GENERATING: { color: "#ea80fc", phase: "Synthesizing the cited report from extracted claims..." },
  COMPLETE: { color: "#00e676", phase: "" },
  FAILED: { color: "#ff1744", phase: "" },
};

const DRStatusBadge = ({ status }: { status: string }) => {
  const c = DR_STATUS[status]?.color || "#ffd600";
  return (
    <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, background: `${c}22`, color: c, border: `1px solid ${c}44`, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
      {IN_PROGRESS.includes(status) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, animation: "drPulse 1.4s ease infinite", display: "inline-block" }} />}
      {status}
    </span>
  );
};

// --- Citations ---------------------------------------------------------

// Turn inline [n] / [2, 3] citation tokens into markdown links with a
// sentinel hash so the <a> renderer below can intercept them. The appended
// "## Sources" list uses `1. **title**` numbering (no brackets) so it's
// untouched.
function linkifyCitations(md: string): string {
  return md.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, nums: string) =>
    nums
      .split(",")
      .map((n) => `[${n.trim()}](#nexus-cite-${n.trim()})`)
      .join("")
  );
}

// Map citation number → Source id. The markdown's "## Sources" numbering is
// canonical (the reporter appends it programmatically), so parse
// `n. **title**` lines and match titles against the report's cited sources.
// Falls back to the API's relevance-ordered list, which mirrors how the
// reporter numbered them.
function buildCiteMap(markdown: string, reportSources: any[]): Map<number, string> {
  const map = new Map<number, string>();
  const byTitle = new Map<string, string>();
  for (const rs of reportSources) {
    if (rs.source?.title && rs.source?.id) byTitle.set(rs.source.title, rs.source.id);
  }
  const section = markdown.split(/\n##\s+Sources\s*\n/)[1] ?? "";
  for (const m of section.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)) {
    const id = byTitle.get(m[2]);
    if (id) map.set(Number(m[1]), id);
  }
  if (map.size === 0) {
    reportSources.forEach((rs: any, i: number) => {
      if (rs.source?.id) map.set(i + 1, rs.source.id);
    });
  }
  return map;
}

// --- Report renderer ---------------------------------------------------

function ReportMarkdown({ markdown, reportSources, onOpenSource }: any) {
  const citeMap = buildCiteMap(markdown, reportSources || []);

  const heading = (size: number, mt: number) => ({ fontSize: size, fontWeight: 700, fontFamily: "'Outfit', sans-serif", color: "#e4e4e7", margin: `${mt}px 0 10px`, letterSpacing: "-0.02em" });

  return (
    <div style={{ fontSize: 14, lineHeight: 1.75, color: "rgba(255,255,255,0.65)" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={heading(22, 24)}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ ...heading(17, 26), paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>{children}</h2>,
          h3: ({ children }) => <h3 style={heading(14, 18)}>{children}</h3>,
          p: ({ children }) => <p style={{ margin: "0 0 12px" }}>{children}</p>,
          strong: ({ children }) => <strong style={{ color: "#e4e4e7", fontWeight: 600 }}>{children}</strong>,
          ul: ({ children }) => <ul style={{ margin: "0 0 12px", paddingLeft: 22 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 12px", paddingLeft: 22 }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote style={{ margin: "0 0 12px", padding: "8px 16px", background: "rgba(124,77,255,0.05)", borderLeft: "2px solid rgba(124,77,255,0.35)", borderRadius: "0 8px 8px 0", color: "rgba(255,255,255,0.5)" }}>{children}</blockquote>
          ),
          code: ({ children, className }) =>
            className ? (
              <code style={{ display: "block", padding: "12px 16px", background: "rgba(0,0,0,0.25)", borderRadius: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, overflow: "auto" }}>{children}</code>
            ) : (
              <code style={{ padding: "1px 6px", background: "rgba(0,0,0,0.3)", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#00e5ff" }}>{children}</code>
            ),
          pre: ({ children }) => <pre style={{ margin: "0 0 12px" }}>{children}</pre>,
          hr: () => <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.07)", margin: "20px 0" }} />,
          table: ({ children }) => (
            <div style={{ overflow: "auto", marginBottom: 12 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={{ textAlign: "left", padding: "6px 12px", borderBottom: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</th>,
          td: ({ children }) => <td style={{ padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{children}</td>,
          a: ({ href, children }) => {
            if (href?.startsWith("#nexus-cite-")) {
              const n = Number(href.slice("#nexus-cite-".length));
              const sourceId = citeMap.get(n);
              return (
                <sup>
                  <button
                    onClick={() => sourceId && onOpenSource?.(sourceId)}
                    title={sourceId ? "Open source in Library" : "Cited source"}
                    style={{ padding: "0 4px", margin: "0 1px", borderRadius: 4, background: "rgba(0,229,255,0.12)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontSize: 10, fontWeight: 600, cursor: sourceId ? "pointer" : "default", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}
                  >
                    {n}
                  </button>
                </sup>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#00e5ff", textDecoration: "none", opacity: 0.85, wordBreak: "break-all" }}>{children}</a>;
          },
        }}
      >
        {linkifyCitations(markdown)}
      </ReactMarkdown>
    </div>
  );
}

// --- Query card --------------------------------------------------------

function QueryCard({ query, expanded, onToggle, onOpenSource }: any) {
  const status = query.status;
  const inProgress = IN_PROGRESS.includes(status);
  const created = query.createdAt ? new Date(query.createdAt).toLocaleString() : "";

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: expanded ? "1px solid rgba(0,229,255,0.15)" : "1px solid rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 10, transition: "all 0.2s", backdropFilter: "blur(12px)", animation: "fadeSlideIn 0.3s ease" }}>
      {/* Header row — click to expand */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 20px", cursor: "pointer" }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 5, transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: "#e4e4e7" }}>{query.originalQuery}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <DRStatusBadge status={status} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{created}</span>
            {status === "COMPLETE" && query.report && (
              <span style={{ fontSize: 11, color: "#00e676", opacity: 0.8 }}>
                {expanded ? "Hide report ▴" : "View report ▾"} · {query.report.sources?.length ?? 0} sources cited
              </span>
            )}
          </div>
          {/* In-progress phase line */}
          {inProgress && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: DR_STATUS[status]?.color || "#00e5ff", animation: "spin 0.9s linear infinite", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{DR_STATUS[status]?.phase}</span>
            </div>
          )}
          {/* Failure message */}
          {status === "FAILED" && query.errorMessage && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,23,68,0.06)", borderLeft: "2px solid rgba(255,23,68,0.4)", borderRadius: "0 6px 6px 0", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              {query.errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 20px 20px 45px", animation: "fadeSlideIn 0.25s ease" }}>
          {/* Search plan */}
          {query.subqueries?.length > 0 && (
            <div style={{ marginBottom: query.report ? 16 : 0, padding: "14px 18px", background: "rgba(124,77,255,0.04)", border: "1px solid rgba(124,77,255,0.1)", borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(179,136,255,0.7)", marginBottom: 10 }}>Search Plan — {query.subqueries.length} angles</div>
              {query.subqueries.map((sq: any, i: number) => (
                <div key={sq.id || i} style={{ display: "flex", gap: 10, marginBottom: i < query.subqueries.length - 1 ? 8 : 0 }}>
                  <span style={{ fontSize: 11, color: "rgba(179,136,255,0.5)", fontFamily: "'JetBrains Mono', monospace", marginTop: 1, flexShrink: 0 }}>{i + 1}.</span>
                  <div>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{sq.text}</span>
                    {sq.rationale && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}> — {sq.rationale}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Report */}
          {status === "COMPLETE" && query.report?.markdown && (
            <div style={{ padding: "20px 24px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>
              <ReportMarkdown markdown={query.report.markdown} reportSources={query.report.sources} onOpenSource={onOpenSource} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main view ---------------------------------------------------------

export default function DeepResearchView({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const [queries, setQueries] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const pollersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const tempIdRef = useRef(0);

  const stopPolling = useCallback((id: string) => {
    if (pollersRef.current[id]) {
      clearInterval(pollersRef.current[id]);
      delete pollersRef.current[id];
    }
  }, []);

  const startPolling = useCallback((id: string) => {
    if (pollersRef.current[id]) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/deep-research/${id}`);
        const data = res.ok ? await res.json() : null;
        if (data?.success) {
          const q = data.data;
          setQueries((prev) => prev.map((p) => (p.id === id ? q : p)));
          if (q.status === "COMPLETE" || q.status === "FAILED") stopPolling(id);
        }
      } catch (_e) { /* transient network error — next tick retries */ }
    };
    pollersRef.current[id] = setInterval(tick, POLL_MS);
    tick();
  }, [stopPolling]);

  // Hydrate from /list, then resume polling anything still in flight (the
  // watcher may be mid-run on a query started in an earlier session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/deep-research/list");
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data?.success) {
          setQueries(data.data);
          data.data.forEach((q: any) => {
            if (IN_PROGRESS.includes(q.status)) startPolling(q.id);
          });
        }
      } catch (_e) { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
      Object.values(pollersRef.current).forEach(clearInterval);
      pollersRef.current = {};
    };
  }, [startPolling]);

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q || submitting) return;
    setSubmitting(true);
    setInput("");

    // Optimistic card — /start runs the planner (a few seconds), so show the
    // query as PLANNING immediately and swap in the real id when it returns.
    const tempId = `pending-${++tempIdRef.current}`;
    setQueries((prev) => [
      { id: tempId, originalQuery: q, status: "PLANNING", createdAt: new Date().toISOString(), subqueries: [], report: null, errorMessage: null },
      ...prev,
    ]);

    try {
      const res = await fetch("/api/deep-research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => ({ success: false, error: "Server error" }));
      if (data.success) {
        const realId = data.data.queryId;
        setQueries((prev) => prev.map((p) => (p.id === tempId ? { ...p, id: realId, status: "SEARCHING" } : p)));
        startPolling(realId);
      } else {
        setQueries((prev) => prev.map((p) => (p.id === tempId ? { ...p, status: "FAILED", errorMessage: data.error || "Planning failed" } : p)));
      }
    } catch (err: any) {
      setQueries((prev) => prev.map((p) => (p.id === tempId ? { ...p, status: "FAILED", errorMessage: err.message } : p)));
    }
    setSubmitting(false);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = input.trim().length > 0 && !submitting;

  return (
    <div style={{ maxWidth: 860 }}>
      <style>{`@keyframes drPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }`}</style>

      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>Deep Research</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 28 }}>
        Ask a research question — Nexus plans sub-queries, searches the literature, ingests the best papers, and synthesizes a cited report.
      </p>

      {/* Input */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,229,255,0.1)", borderRadius: 14, padding: "18px 20px", marginBottom: 32, backdropFilter: "blur(12px)" }}>
        <textarea
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); } }}
          placeholder="e.g. How do natural full-spectrum psilocybin extracts compare to synthetic psilocybin in clinical outcomes?"
          rows={4}
          style={{ width: "100%", padding: "12px 14px", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e4e4e7", fontSize: 14, fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: 1.6, transition: "border-color 0.2s" }}
          onFocus={(e: any) => (e.target.style.borderColor = "rgba(0,229,255,0.3)")}
          onBlur={(e: any) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
        />
        <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>Runs take a few minutes — papers are searched, evaluated, and ingested before the report is written. ⌘↵ to submit.</span>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ marginLeft: "auto", padding: "10px 24px", borderRadius: 10, border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: canSubmit ? "pointer" : "default", background: canSubmit ? "linear-gradient(135deg, #00e5ff, #7c4dff)" : "rgba(255,255,255,0.05)", color: canSubmit ? "#000" : "rgba(255,255,255,0.2)", transition: "all 0.2s", flexShrink: 0 }}
          >
            {submitting ? "Planning..." : "Run research"}
          </button>
        </div>
      </div>

      {/* Past queries */}
      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 12, fontWeight: 600 }}>
        Research History{queries.length > 0 ? ` (${queries.length})` : ""}
      </h3>
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", padding: "24px 0", color: "rgba(255,255,255,0.3)" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
          <span style={{ marginLeft: 10, fontSize: 13 }}>Loading research history...</span>
        </div>
      ) : queries.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
          No research runs yet — ask your first question above.
        </div>
      ) : (
        queries.map((q) => (
          <QueryCard key={q.id} query={q} expanded={expandedIds.has(q.id)} onToggle={() => toggleExpanded(q.id)} onOpenSource={onOpenSource} />
        ))
      )}
    </div>
  );
}
