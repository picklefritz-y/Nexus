"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Simple groupBy utility
function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// FSRS client-side retrievability calculation
const FSRS = {
  getRetrievability(card: any) {
    if (!card || card.state === 0 || !card.lastReview) return 0;
    const elapsed = (Date.now() - new Date(card.lastReview).getTime()) / (1000 * 60 * 60 * 24);
    if (card.stability <= 0) return 0;
    return Math.pow(1 + elapsed / (9 * card.stability), -1);
  },
};

// Default theme colors
const DEFAULT_COLORS: Record<string, { bg: string; accent: string; icon: string }> = {
  "Mitochondrial Function": { bg: "#1a0a2e", accent: "#e040fb", icon: "⚡" },
  "Metabolic Health": { bg: "#0a1628", accent: "#00e5ff", icon: "🔬" },
  "Strength Training": { bg: "#1a0f0a", accent: "#ff6d00", icon: "💪" },
  "Precious Metals": { bg: "#0f1a0a", accent: "#ffd600", icon: "🥇" },
  "Neuroscience": { bg: "#0a0f1a", accent: "#7c4dff", icon: "🧠" },
  "Longevity": { bg: "#0a1a14", accent: "#00e676", icon: "🧬" },
  "Nutrition": { bg: "#1a0a0f", accent: "#ff4081", icon: "🥗" },
  "Sleep Science": { bg: "#0a0a1a", accent: "#448aff", icon: "😴" },
  "Cardiovascular Health": { bg: "#1a0a14", accent: "#ff5252", icon: "❤️" },
  "Peptide Therapy": { bg: "#140a1a", accent: "#ea80fc", icon: "💉" },
  "Hormonal Health": { bg: "#1a140a", accent: "#ffab40", icon: "⚖️" },
};
const GENERATED_ACCENTS = ["#ff6e40", "#69f0ae", "#40c4ff", "#ea80fc", "#ffd740", "#b2ff59", "#ff80ab", "#84ffff"];
let colorIdx = 0;
function getThemeColors(name: string, dbIcon?: string, dbColor?: string, dbBg?: string) {
  if (DEFAULT_COLORS[name]) return { icon: dbIcon || DEFAULT_COLORS[name].icon, accent: dbColor || DEFAULT_COLORS[name].accent, bg: dbBg || DEFAULT_COLORS[name].bg };
  const accent = dbColor || GENERATED_ACCENTS[colorIdx++ % GENERATED_ACCENTS.length];
  return { icon: dbIcon || "📂", accent, bg: dbBg || "#0a0f14" };
}

const SOURCE_ICONS: Record<string, string> = { podcast: "🎙️", PODCAST: "🎙️", paper: "📄", PAPER: "📄", article: "📝", ARTICLE: "📝", book: "📚", BOOK: "📚" };

// API data transformers
function transformSource(s: any): any {
  return { id: s.id, type: (s.type || "article").toLowerCase(), title: s.title, author: s.author || "Unknown", date: s.publicationDate?.split("T")[0] || s.addedAt?.split("T")[0] || "", themes: (s.themes || []).map((t: any) => t.theme?.name || t.name || t), summary: s.summary || "", url: s.url || "", claimCount: s.claims?.length || s.claimCount || 0 };
}

function transformClaim(c: any): any {
  const card = c.reviewCards?.[0] || c.card || { due: new Date(), stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, lastReview: null, elapsedDays: 0, scheduledDays: 0 };
  return {
    id: c.id, text: c.text, status: (c.status || "emerging").toLowerCase(), confidence: c.confidence || 0.5, explanation: c.explanation, implications: c.implications,
    themes: (c.themes || []).map((t: any) => t.theme?.name || t.name || t),
    sources: (c.sources || []).map((s: any) => s.source?.id || s.sourceId || s),
    sourceDetails: (c.sources || []).map((s: any) => ({ id: s.source?.id || s.sourceId, title: s.source?.title || "Source", author: s.source?.author || "", type: (s.source?.type || "article").toLowerCase(), summary: s.source?.summary || "", supportingQuote: s.extractedText || "" })),
    contradicts: [...(c.contradicts || []).map((x: any) => x.contradicted?.id || x.contradictedId), ...(c.contradictedBy || []).map((x: any) => x.claim?.id || x.claimId)].filter(Boolean),
    contradictionDetails: [...(c.contradicts || []).map((x: any) => ({ id: x.contradicted?.id, text: x.contradicted?.text, status: (x.contradicted?.status || "").toLowerCase() })), ...(c.contradictedBy || []).map((x: any) => ({ id: x.claim?.id, text: x.claim?.text, status: (x.claim?.status || "").toLowerCase() }))].filter((x: any) => x.id),
    card: { due: card.due, stability: card.stability || 0, difficulty: card.difficulty || 0, elapsedDays: card.elapsedDays || 0, scheduledDays: card.scheduledDays || 0, reps: card.reps || 0, lapses: card.lapses || 0, state: card.state || 0, lastReview: card.lastReview },
    cardId: card.id,
  };
}

// Utility components
const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, any> = { consensus: { bg: "rgba(0,230,118,0.15)", text: "#00e676", border: "rgba(0,230,118,0.3)" }, supported: { bg: "rgba(0,229,255,0.15)", text: "#00e5ff", border: "rgba(0,229,255,0.3)" }, emerging: { bg: "rgba(255,213,0,0.15)", text: "#ffd600", border: "rgba(255,213,0,0.3)" }, contested: { bg: "rgba(255,64,129,0.15)", text: "#ff4081", border: "rgba(255,64,129,0.3)" }, contradicted: { bg: "rgba(255,23,68,0.15)", text: "#ff1744", border: "rgba(255,23,68,0.3)" } };
  const c = colors[status] || colors.emerging;
  return <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 20, background: c.bg, color: c.text, border: `1px solid ${c.border}`, whiteSpace: "nowrap" }}>{status}</span>;
};

const ConfidenceBar = ({ value, color = "#00e5ff" }: { value: number; color?: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
    <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${value * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
    </div>
    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>{Math.round(value * 100)}%</span>
  </div>
);

const RetentionRing = ({ value, size = 48, color = "#00e5ff" }: { value: number; size?: number; color?: string }) => {
  const v = Math.max(0, Math.min(1, value || 0));
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={3} strokeDasharray={circ} strokeDashoffset={circ * (1 - v)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <span style={{ position: "absolute", fontSize: size < 50 ? 11 : 14, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{Math.round(v * 100)}</span>
    </div>
  );
};

const Spinner = () => <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, color: "rgba(255,255,255,0.3)" }}><span style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} /><span style={{ marginLeft: 12, fontSize: 14 }}>Loading...</span></div>;

// ============================================================
// Visual Effects — Neural Particle Network + Aurora
// ============================================================
function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W = 0, H = 0;

    interface Neuron {
      x: number; y: number; z: number; // z = depth layer (0=far, 1=near)
      size: number; pulse: number; brightness: number; cooldown: number;
      dendrites: { angle: number; length: number; branches: { t: number; angle: number; length: number }[] }[];
    }
    interface Signal {
      neuronIdx: number; dendriteIdx: number;
      progress: number; speed: number; intensity: number;
      branchIdx: number; // -1 = main dendrite, >=0 = branch index
    }
    interface Glow {
      x: number; y: number; radius: number; alpha: number; color: string;
    }

    const neurons: Neuron[] = [];
    const signals: Signal[] = [];
    const glows: Glow[] = [];
    const NEURON_COUNT = 18;
    const SIGNAL_CHANCE = 0.003;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Create neurons with dendrites
    for (let i = 0; i < NEURON_COUNT; i++) {
      const z = Math.random(); // depth
      const dendriteCount = 3 + Math.floor(Math.random() * 4);
      const dendrites: Neuron["dendrites"] = [];

      for (let d = 0; d < dendriteCount; d++) {
        const angle = (d / dendriteCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const length = 60 + Math.random() * 140 + z * 60;
        const branchCount = Math.floor(Math.random() * 3);
        const branches: { t: number; angle: number; length: number }[] = [];
        for (let b = 0; b < branchCount; b++) {
          branches.push({
            t: 0.3 + Math.random() * 0.5,
            angle: angle + (Math.random() - 0.5) * 1.2,
            length: 20 + Math.random() * 50,
          });
        }
        dendrites.push({ angle, length, branches });
      }

      neurons.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z,
        size: 4 + z * 6,
        pulse: Math.random() * Math.PI * 2,
        brightness: 0.1 + z * 0.1,
        cooldown: 0,
        dendrites,
      });
    }

    // Get point along dendrite using quadratic curve
    const getDendritePoint = (n: Neuron, d: Neuron["dendrites"][0], t: number) => {
      const cx = n.x + Math.cos(d.angle + 0.3) * d.length * 0.5;
      const cy = n.y + Math.sin(d.angle + 0.3) * d.length * 0.5;
      const ex = n.x + Math.cos(d.angle) * d.length;
      const ey = n.y + Math.sin(d.angle) * d.length;
      const mt = 1 - t;
      return {
        x: mt * mt * n.x + 2 * mt * t * cx + t * t * ex,
        y: mt * mt * n.y + 2 * mt * t * cy + t * t * ey,
      };
    };

    const drawDendrite = (n: Neuron, d: Neuron["dendrites"][0], alpha: number, width: number) => {
      const cx = n.x + Math.cos(d.angle + 0.3) * d.length * 0.5;
      const cy = n.y + Math.sin(d.angle + 0.3) * d.length * 0.5;
      const ex = n.x + Math.cos(d.angle) * d.length;
      const ey = n.y + Math.sin(d.angle) * d.length;

      // Main dendrite - gradient fade
      const grad = ctx.createLinearGradient(n.x, n.y, ex, ey);
      grad.addColorStop(0, `rgba(80, 160, 220, ${alpha})`);
      grad.addColorStop(1, `rgba(50, 100, 180, ${alpha * 0.2})`);
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.stroke();

      // Branches
      for (const br of d.branches) {
        const branchStart = getDendritePoint(n, d, br.t);
        const bex = branchStart.x + Math.cos(br.angle) * br.length;
        const bey = branchStart.y + Math.sin(br.angle) * br.length;
        const bcx = branchStart.x + Math.cos(br.angle + 0.2) * br.length * 0.5;
        const bcy = branchStart.y + Math.sin(br.angle + 0.2) * br.length * 0.5;

        const bGrad = ctx.createLinearGradient(branchStart.x, branchStart.y, bex, bey);
        bGrad.addColorStop(0, `rgba(80, 160, 220, ${alpha * 0.6})`);
        bGrad.addColorStop(1, `rgba(50, 100, 180, ${alpha * 0.05})`);
        ctx.beginPath();
        ctx.moveTo(branchStart.x, branchStart.y);
        ctx.quadraticCurveTo(bcx, bcy, bex, bey);
        ctx.strokeStyle = bGrad;
        ctx.lineWidth = width * 0.5;
        ctx.stroke();
      }
    };

    const draw = () => {
      // Soft fade
      ctx.fillStyle = "rgba(12, 34, 64, 0.25)";
      ctx.fillRect(0, 0, W, H);

      // Sort by depth (far first)
      const sorted = neurons.map((n, i) => ({ n, i })).sort((a, b) => a.n.z - b.n.z);

      // Draw dendrites (back to front)
      for (const { n } of sorted) {
        const depthAlpha = 0.08 + n.z * 0.18;
        const depthWidth = 0.5 + n.z * 1.5;
        for (const d of n.dendrites) {
          drawDendrite(n, d, depthAlpha, depthWidth);
        }
      }

      // Randomly fire signals
      for (let i = 0; i < neurons.length; i++) {
        const n = neurons[i];
        if (n.cooldown > 0) { n.cooldown--; continue; }
        if (Math.random() < SIGNAL_CHANCE) {
          const dIdx = Math.floor(Math.random() * n.dendrites.length);
          signals.push({
            neuronIdx: i, dendriteIdx: dIdx,
            progress: 0, speed: 0.006 + Math.random() * 0.008,
            intensity: 0.6 + Math.random() * 0.4,
            branchIdx: -1,
          });
          n.cooldown = 60 + Math.floor(Math.random() * 60);
          n.brightness = 0.5;
        }
      }

      // Draw signals
      for (let s = signals.length - 1; s >= 0; s--) {
        const sig = signals[s];
        const n = neurons[sig.neuronIdx];
        const d = n.dendrites[sig.dendriteIdx];
        sig.progress += sig.speed;

        if (sig.progress >= 1) {
          // Spawn branch signals
          if (sig.branchIdx === -1) {
            for (let bi = 0; bi < d.branches.length; bi++) {
              if (Math.random() < 0.6) {
                signals.push({
                  neuronIdx: sig.neuronIdx, dendriteIdx: sig.dendriteIdx,
                  progress: 0, speed: sig.speed * 0.8,
                  intensity: sig.intensity * 0.6,
                  branchIdx: bi,
                });
              }
            }
          }
          // End glow
          const endPt = sig.branchIdx === -1
            ? getDendritePoint(n, d, 1)
            : (() => {
                const br = d.branches[sig.branchIdx];
                const brStart = getDendritePoint(n, d, br.t);
                const bex = brStart.x + Math.cos(br.angle) * br.length;
                const bey = brStart.y + Math.sin(br.angle) * br.length;
                return { x: bex, y: bey };
              })();
          glows.push({ x: endPt.x, y: endPt.y, radius: 3, alpha: sig.intensity * 0.4, color: "255, 160, 40" });
          signals.splice(s, 1);
          continue;
        }

        // Get signal position
        let pos: { x: number; y: number };
        if (sig.branchIdx === -1) {
          pos = getDendritePoint(n, d, sig.progress);
        } else {
          const br = d.branches[sig.branchIdx];
          const brStart = getDendritePoint(n, d, br.t);
          const bex = brStart.x + Math.cos(br.angle) * br.length;
          const bey = brStart.y + Math.sin(br.angle) * br.length;
          const bcx = brStart.x + Math.cos(br.angle + 0.2) * br.length * 0.5;
          const bcy = brStart.y + Math.sin(br.angle + 0.2) * br.length * 0.5;
          const mt = 1 - sig.progress;
          pos = {
            x: mt * mt * brStart.x + 2 * mt * sig.progress * bcx + sig.progress * sig.progress * bex,
            y: mt * mt * brStart.y + 2 * mt * sig.progress * bcy + sig.progress * sig.progress * bey,
          };
        }

        // Draw signal pulse — warm orange/gold
        const pulseSize = (1 + n.z) * 2 * sig.intensity;
        const outerGlow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, pulseSize * 6);
        outerGlow.addColorStop(0, `rgba(255, 160, 40, ${sig.intensity * 0.15})`);
        outerGlow.addColorStop(0.5, `rgba(255, 100, 20, ${sig.intensity * 0.05})`);
        outerGlow.addColorStop(1, `rgba(255, 60, 10, 0)`);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pulseSize * 6, 0, Math.PI * 2);
        ctx.fillStyle = outerGlow;
        ctx.fill();

        // Core
        const coreGlow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, pulseSize);
        coreGlow.addColorStop(0, `rgba(255, 220, 140, ${sig.intensity * 0.7})`);
        coreGlow.addColorStop(1, `rgba(255, 140, 40, ${sig.intensity * 0.2})`);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pulseSize, 0, Math.PI * 2);
        ctx.fillStyle = coreGlow;
        ctx.fill();
      }

      // Draw glows (signal endpoints)
      for (let g = glows.length - 1; g >= 0; g--) {
        const gw = glows[g];
        gw.radius += 0.4;
        gw.alpha *= 0.94;
        if (gw.alpha < 0.01) { glows.splice(g, 1); continue; }
        const gg = ctx.createRadialGradient(gw.x, gw.y, 0, gw.x, gw.y, gw.radius * 3);
        gg.addColorStop(0, `rgba(${gw.color}, ${gw.alpha})`);
        gg.addColorStop(1, `rgba(${gw.color}, 0)`);
        ctx.beginPath();
        ctx.arc(gw.x, gw.y, gw.radius * 3, 0, Math.PI * 2);
        ctx.fillStyle = gg;
        ctx.fill();
      }

      // Draw neuron cell bodies (back to front)
      for (const { n } of sorted) {
        n.pulse += 0.015;
        n.brightness += (0.1 + n.z * 0.1 - n.brightness) * 0.02;

        const breathe = 1 + Math.sin(n.pulse) * 0.08;
        const r = n.size * breathe;

        // Outer atmosphere
        const atmo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 5);
        atmo.addColorStop(0, `rgba(60, 120, 200, ${n.brightness * 0.2})`);
        atmo.addColorStop(0.4, `rgba(40, 80, 160, ${n.brightness * 0.06})`);
        atmo.addColorStop(1, `rgba(30, 60, 130, 0)`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 5, 0, Math.PI * 2);
        ctx.fillStyle = atmo;
        ctx.fill();

        // Cell body
        const body = ctx.createRadialGradient(n.x - r * 0.2, n.y - r * 0.2, 0, n.x, n.y, r);
        body.addColorStop(0, `rgba(160, 210, 255, ${n.brightness * 0.8})`);
        body.addColorStop(0.6, `rgba(80, 140, 220, ${n.brightness * 0.5})`);
        body.addColorStop(1, `rgba(40, 80, 160, ${n.brightness * 0.15})`);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();

        // Nucleus highlight
        ctx.beginPath();
        ctx.arc(n.x - r * 0.15, n.y - r * 0.15, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210, 230, 255, ${n.brightness * 0.3})`;
        ctx.fill();

        // Fire glow (warm) when active
        if (n.brightness > 0.25) {
          const fireGlow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
          fireGlow.addColorStop(0, `rgba(255, 160, 60, ${(n.brightness - 0.25) * 0.2})`);
          fireGlow.addColorStop(1, `rgba(255, 100, 30, 0)`);
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = fireGlow;
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(draw);
    };

    // Initial fill
    ctx.fillStyle = "#0c2240";
    ctx.fillRect(0, 0, W, H);
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}

// ============================================================
// Main App
// ============================================================
export default function NexusApp() {
  const [view, setView] = useState("dashboard");
  const [sources, setSources] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [themeColors, setThemeColors] = useState<Record<string, { bg: string; accent: string; icon: string }>>({});
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [ingestUrl, setIngestUrl] = useState("");
  const [ingestStep, setIngestStep] = useState(0);
  const [ingestStatus, setIngestStatus] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [animateIn, setAnimateIn] = useState(false);
  const [selectedSource, setSelectedSource] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<any>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [dashRes, contentRes, claimsRes] = await Promise.all([
        fetch("/api/dashboard").then(r => r.ok ? r.json() : { success: false }),
        fetch("/api/content").then(r => r.ok ? r.json() : { success: false }),
        fetch("/api/claims").then(r => r.ok ? r.json() : { success: false }),
      ]);
      if (contentRes.success && contentRes.data) setSources((Array.isArray(contentRes.data) ? contentRes.data : []).map(transformSource));
      if (claimsRes.success && claimsRes.data) setClaims((Array.isArray(claimsRes.data) ? claimsRes.data : []).map(transformClaim));
      if (dashRes.success && dashRes.data?.themes) {
        const cm: Record<string, any> = {};
        dashRes.data.themes.forEach((t: any) => { cm[t.name] = getThemeColors(t.name, t.icon, t.color, t.bgColor); });
        setThemeColors(cm);
      }
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setAnimateIn(true); }, []);
  useEffect(() => { setAnimateIn(false); const t = setTimeout(() => setAnimateIn(true), 50); return () => clearTimeout(t); }, [view, selectedTheme]);

  // Cmd+K search shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
        setSearchQuery(""); setSearchResults(null);
      }
      if (e.key === "Escape" && searchOpen) { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  useEffect(() => { if (searchOpen && searchInputRef.current) searchInputRef.current.focus(); }, [searchOpen]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.success) setSearchResults(data.data);
      } catch {} finally { setSearchLoading(false); }
    }, 300);
  }, []);

  const handleSearchSelect = useCallback((type: string, item: any) => {
    setSearchOpen(false); setSearchQuery(""); setSearchResults(null);
    if (type === "theme") { setSelectedTheme(item.name); setView("dashboard"); }
    else if (type === "source") { setSelectedSource(item); setView("library"); }
    else if (type === "claim") { setView("claims"); }
  }, []);

  const tc = (name: string) => themeColors[name] || getThemeColors(name);

  // Build theme stats
  const themeStats = (() => {
    const allNames = new Set<string>();
    sources.forEach(s => s.themes?.forEach((t: string) => allNames.add(t)));
    claims.forEach(c => c.themes?.forEach((t: string) => allNames.add(t)));
    return Array.from(allNames).map(name => {
      const ts = sources.filter(s => s.themes.includes(name));
      const tcs = claims.filter(c => c.themes.includes(name));
      const ret = tcs.length > 0 ? tcs.reduce((s: number, c: any) => s + FSRS.getRetrievability(c.card), 0) / tcs.length : 0;
      const colors = tc(name);
      return { name, sources: ts.length, claims: tcs.length, retention: ret, contradictions: tcs.filter((c: any) => c.contradicts?.length > 0).length, ...colors };
    }).filter(t => t.sources > 0 || t.claims > 0).sort((a, b) => b.claims - a.claims);
  })();

  const dueCards = claims.filter(c => new Date(c.card.due) <= new Date());

  const startReview = (themeFilter: string | null = null) => {
    const queue = themeFilter ? dueCards.filter(c => c.themes.includes(themeFilter)) : dueCards;
    if (queue.length === 0) return;
    setReviewQueue(queue); setCurrentReviewIndex(0); setShowAnswer(false); setView("review");
  };

  const handleRating = async (rating: number) => {
    const claim = reviewQueue[currentReviewIndex];
    try {
      const res = await fetch("/api/review/rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: claim.cardId, rating, promptType: ["recall", "reflection", "correlation"][currentReviewIndex % 3] }) });
      const data = await res.json();
      if (data.success) {
        const newCard = { ...claim.card, due: data.data.newDue, stability: data.data.stability, difficulty: data.data.difficulty, scheduledDays: data.data.scheduledDays, reps: data.data.reps, lapses: data.data.lapses, state: data.data.state, lastReview: new Date().toISOString() };
        setClaims(prev => prev.map(c => c.id === claim.id ? { ...c, card: newCard } : c));
        setReviewQueue(prev => prev.map((c: any, i: number) => i === currentReviewIndex ? { ...c, card: newCard } : c));
      }
    } catch (err) { console.error("Rating error:", err); }
    if (currentReviewIndex < reviewQueue.length - 1) { setCurrentReviewIndex(prev => prev + 1); setShowAnswer(false); } else { setView("dashboard"); fetchData(); }
  };

  const handleIngest = async () => {
    if (!ingestUrl.trim()) return;
    setIngestStep(1); setIngestStatus("Submitting...");
    try {
      setIngestStep(2); setIngestStatus("Processing — this takes 15–30 seconds...");
      const res = await fetch("/api/content/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: ingestUrl }) });
      const data = await res.json();
      if (!data.success) { setIngestStatus(`Error: ${data.error}`); setIngestStep(0); return; }
      const status = data.data.status;
      if (status === "COMPLETE") {
        setIngestStep(6); setIngestStatus("Complete!");
        setTimeout(() => { setIngestStep(0); setIngestUrl(""); fetchData(); }, 2500);
      } else if (status === "FAILED") {
        setIngestStatus(`Failed: ${data.data.error || "Unknown error"}`); setIngestStep(0);
      } else {
        // Fallback: poll if somehow we get PENDING back (e.g. local dev with old route)
        const sourceId = data.data.sourceId;
        setIngestStep(2); setIngestStatus("Processing...");
        const poll = setInterval(async () => {
          try {
            const sr = await fetch(`/api/content/${sourceId}`); const sd = await sr.json();
            if (sd.success) {
              const st = sd.data.status;
              if (st === "FETCHING") { setIngestStep(2); setIngestStatus("Fetching content..."); }
              else if (st === "EXTRACTING") { setIngestStep(3); setIngestStatus("Extracting text..."); }
              else if (st === "PROCESSING") { setIngestStep(4); setIngestStatus("AI processing claims..."); }
              else if (st === "LINKING") { setIngestStep(5); setIngestStatus("Building knowledge graph..."); }
              else if (st === "COMPLETE") { clearInterval(poll); setIngestStep(6); setIngestStatus("Complete!"); setTimeout(() => { setIngestStep(0); setIngestUrl(""); fetchData(); }, 2500); }
              else if (st === "FAILED") { clearInterval(poll); setIngestStatus(`Failed: ${sd.data.processingError || "Unknown"}`); setIngestStep(0); }
            }
          } catch {}
        }, 3000);
        setTimeout(() => clearInterval(poll), 300000);
      }
    } catch (err: any) { setIngestStatus(`Error: ${err.message}`); setIngestStep(0); }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "◆" },
    { id: "chat", label: "Chat", icon: "◬" },
    { id: "tables", label: "Tables", icon: "▤" },
    { id: "graph", label: "Graph", icon: "◉" },
    { id: "analytics", label: "Analytics", icon: "▦" },
    { id: "library", label: "Library", icon: "◫" },
    { id: "claims", label: "Claims", icon: "◈" },
    { id: "ingest", label: "Add Content", icon: "+" },
    { id: "review", label: `Review${dueCards.length > 0 ? ` (${dueCards.length})` : ""}`, icon: "↻" },
  ];

  const handleNav = (id: string) => { if (id === "review") { startReview(selectedTheme); return; } setSelectedTheme(null); setView(id); };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: "#0c2240", color: "#e4e4e7", minHeight: "100vh", display: "flex", overflow: "hidden", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:wght@700;800;900&family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes auroraShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 12px rgba(0,229,255,0.15), 0 0 40px rgba(0,229,255,0.05); }
          50% { box-shadow: 0 0 20px rgba(0,229,255,0.25), 0 0 60px rgba(0,229,255,0.1); }
        }
        @keyframes logoPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(0,229,255,0.3), 0 0 24px rgba(124,77,255,0.15); }
          50% { box-shadow: 0 0 16px rgba(0,229,255,0.5), 0 0 40px rgba(124,77,255,0.25); }
        }
        @keyframes scanline { from { transform: translateY(-100%); } to { transform: translateY(100vh); } }
        @keyframes borderGlow {
          0%, 100% { border-color: rgba(0,229,255,0.1); }
          50% { border-color: rgba(0,229,255,0.25); }
        }
        button:hover { filter: brightness(1.15); }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.15); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,229,255,0.3); }
      `}</style>

      {/* Neural particle background */}
      <NeuralBackground />

      {/* Aurora gradient overlay */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.35,
        background: "radial-gradient(ellipse 80% 50% at 20% 40%, rgba(40,100,200,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 60%, rgba(60,80,180,0.1) 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 50% 100%, rgba(30,80,170,0.08) 0%, transparent 50%)",
        backgroundSize: "200% 200%",
        animation: "auroraShift 25s ease infinite",
      }} />

      {/* Sidebar */}
      <div style={{ width: sidebarOpen ? 220 : 60, minWidth: sidebarOpen ? 220 : 60, background: "rgba(10,28,52,0.85)", backdropFilter: "blur(20px)", borderRight: "1px solid rgba(0,229,255,0.06)", display: "flex", flexDirection: "column", transition: "all 0.3s ease", zIndex: 10, position: "relative" }}>
        <div style={{ padding: "24px 16px 32px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #00e5ff 0%, #7c4dff 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#000", flexShrink: 0, animation: "logoPulse 3s ease infinite" }}>N</div>
          {sidebarOpen && <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.05em", fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #00e5ff, #7c4dff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>NEXUS</span>}
        </div>
        <nav style={{ flex: 1, padding: "0 8px" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => handleNav(item.id)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", marginBottom: 2, background: view === item.id ? "rgba(0,229,255,0.08)" : "transparent", border: view === item.id ? "1px solid rgba(0,229,255,0.15)" : "1px solid transparent", borderRadius: 8, color: view === item.id ? "#00e5ff" : "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.3s", textAlign: "left", fontFamily: "inherit", boxShadow: view === item.id ? "0 0 16px rgba(0,229,255,0.08), inset 0 0 12px rgba(0,229,255,0.03)" : "none" }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && item.label}
            </button>
          ))}
        </nav>
        {/* Search button */}
        <button onClick={() => { setSearchOpen(true); setSearchQuery(""); setSearchResults(null); }} style={{ margin: "0 12px 8px", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all 0.2s" }}>
          <span style={{ fontSize: 14 }}>⌕</span>
          {sidebarOpen && <><span>Search</span><span style={{ marginLeft: "auto", fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.25)" }}>⌘K</span></>}
        </button>
        <button onClick={() => setSidebarOpen(p => !p)} style={{ margin: 12, padding: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>{sidebarOpen ? "◁" : "▷"}</button>
      </div>

      {/* Search Overlay */}
      {searchOpen && (
        <div onClick={(e) => { if (e.target === e.currentTarget) { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); } }} style={{ position: "fixed", inset: 0, background: "rgba(6,18,36,0.75)", backdropFilter: "blur(16px)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "15vh" }}>
          <div style={{ width: "100%", maxWidth: 600, background: "rgba(12,30,56,0.92)", border: "1px solid rgba(0,229,255,0.1)", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(0,229,255,0.05)", animation: "fadeSlideIn 0.2s ease", backdropFilter: "blur(20px)" }}>
            {/* Search input */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 18, color: "rgba(255,255,255,0.3)" }}>⌕</span>
              <input ref={searchInputRef} value={searchQuery} onChange={(e) => handleSearch(e.target.value)} placeholder="Search claims, sources, themes..." style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e4e4e7", fontSize: 16, fontFamily: "inherit" }} />
              {searchLoading && <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} />}
              <button onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); }} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: "2px 8px", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>ESC</button>
            </div>

            {/* Results */}
            <div style={{ maxHeight: "50vh", overflow: "auto", padding: searchResults ? "8px" : "0" }}>
              {searchQuery.length >= 2 && !searchResults && !searchLoading && (
                <div style={{ padding: "24px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>Searching...</div>
              )}
              {searchResults && searchResults.themes?.length === 0 && searchResults.claims?.length === 0 && searchResults.sources?.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>No results for "{searchQuery}"</div>
              )}

              {/* Theme results */}
              {searchResults?.themes?.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)" }}>Themes</div>
                  {searchResults.themes.map((t: any) => (
                    <button key={t.id} onClick={() => handleSearchSelect("theme", t)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderRadius: 8, color: "#e4e4e7", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ fontSize: 20 }}>{t.icon || "📂"}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{t.sources?.length || 0} sources · {t.claims?.length || 0} claims</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Claim results */}
              {searchResults?.claims?.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)" }}>Claims ({searchResults.claims.length})</div>
                  {searchResults.claims.map((c: any) => {
                    const themeName = c.themes?.[0]?.theme?.name;
                    const themeColor = themeName ? tc(themeName).accent : "#666";
                    return (
                      <button key={c.id} onClick={() => handleSearchSelect("claim", c)} style={{ display: "flex", alignItems: "flex-start", gap: 12, width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderRadius: 8, color: "#e4e4e7", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: themeColor, marginTop: 6, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{c.text.length > 100 ? c.text.slice(0, 97) + "..." : c.text}</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                            <StatusBadge status={(c.status || "emerging").toLowerCase()} />
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{Math.round((c.confidence || 0.5) * 100)}% confidence</span>
                            {c.themes?.map((t: any) => <span key={t.theme?.id} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${tc(t.theme?.name).accent}12`, color: tc(t.theme?.name).accent }}>{t.theme?.name}</span>)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Source results */}
              {searchResults?.sources?.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)" }}>Sources ({searchResults.sources.length})</div>
                  {searchResults.sources.map((s: any) => (
                    <button key={s.id} onClick={() => handleSearchSelect("source", transformSource(s))} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderRadius: 8, color: "#e4e4e7", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ fontSize: 20 }}>{SOURCE_ICONS[(s.type || "").toLowerCase()] || "📝"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.author || "Unknown"} · {s.claims?.length || 0} claims</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer hint */}
            {!searchResults && searchQuery.length < 2 && (
              <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 16, justifyContent: "center" }}>
                {[{ icon: "◈", label: "claims" }, { icon: "◫", label: "sources" }, { icon: "◉", label: "themes" }].map(h => (
                  <span key={h.label} style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>{h.icon} {h.label}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "32px 40px", opacity: animateIn ? 1 : 0, transform: animateIn ? "translateY(0)" : "translateY(12px)", transition: "opacity 0.4s ease, transform 0.4s ease", position: "relative", zIndex: 5 }}>
        {loading && <Spinner />}
        {error && <div style={{ padding: 40, color: "#ff4081" }}>Error: {error}</div>}
        {!loading && !error && <>
          {view === "dashboard" && !selectedTheme && <DashboardView themeStats={themeStats} sources={sources} claims={claims} dueCards={dueCards} onThemeClick={setSelectedTheme} onStartReview={() => startReview()} FSRS={FSRS} tc={tc} />}
          {view === "dashboard" && selectedTheme && <ThemeDetailView theme={selectedTheme} sources={sources} claims={claims} FSRS={FSRS} onBack={() => setSelectedTheme(null)} onStartReview={() => startReview(selectedTheme)} tc={tc} />}
          {view === "library" && <LibraryView sources={sources} claims={claims} selectedSource={selectedSource} onSelectSource={setSelectedSource} tc={tc} />}
          {view === "claims" && <ClaimsView claims={claims} sources={sources} FSRS={FSRS} tc={tc} />}
          {view === "graph" && <GraphView claims={claims} sources={sources} themeStats={themeStats} tc={tc} FSRS={FSRS} />}
          {view === "analytics" && <AnalyticsView tc={tc} />}
          {view === "chat" && <ChatView tc={tc} />}
          {view === "tables" && <TablesView tc={tc} />}
          {view === "ingest" && <IngestView url={ingestUrl} setUrl={setIngestUrl} step={ingestStep} onSubmit={handleIngest} statusMessage={ingestStatus} />}
          {view === "review" && reviewQueue.length > 0 && <ReviewView claim={reviewQueue[currentReviewIndex]} index={currentReviewIndex} total={reviewQueue.length} showAnswer={showAnswer} onReveal={() => setShowAnswer(true)} onRate={handleRating} sources={sources} claims={claims} FSRS={FSRS} tc={tc} />}
        </>}
      </div>
    </div>
  );
}

// ============================================================
// Dashboard View
// ============================================================
function DashboardView({ themeStats, sources, claims, dueCards, onThemeClick, onStartReview, FSRS, tc }: any) {
  const totalRet = claims.length > 0 ? claims.reduce((s: number, c: any) => s + FSRS.getRetrievability(c.card), 0) / claims.length : 0;
  const recent = [...sources].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  const consensus = claims.filter((c: any) => c.status === "consensus").length;
  const contested = claims.filter((c: any) => c.status === "contested" || c.contradicts?.length > 0).length;

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #e4e4e7 30%, rgba(228,228,231,0.5))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", textShadow: "0 0 40px rgba(0,229,255,0.15)" }}>Knowledge Dashboard</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 8 }}>{sources.length} sources · {claims.length} tracked claims · {dueCards.length} due for review</p>
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 36 }}>
        {[
          { label: "Overall Retention", value: <RetentionRing value={totalRet} size={56} />, sub: "across all themes" },
          { label: "Consensus Claims", value: <span style={{ fontSize: 28, fontWeight: 700, color: "#00e676", fontFamily: "'JetBrains Mono'" }}>{consensus}</span>, sub: "well-supported" },
          { label: "Active Debates", value: <span style={{ fontSize: 28, fontWeight: 700, color: "#ff4081", fontFamily: "'JetBrains Mono'" }}>{contested}</span>, sub: "contradictions found" },
          { label: "Due for Review", value: <button onClick={onStartReview} disabled={dueCards.length === 0} style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: dueCards.length > 0 ? "#ffd600" : "rgba(255,255,255,0.3)", background: dueCards.length > 0 ? "rgba(255,214,0,0.1)" : "transparent", border: dueCards.length > 0 ? "1px solid rgba(255,214,0,0.2)" : "none", borderRadius: 8, padding: "4px 16px", cursor: dueCards.length > 0 ? "pointer" : "default" }}>{dueCards.length}</button>, sub: "start session →" },
        ].map((stat: any, i: number) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,229,255,0.06)", borderRadius: 12, padding: "20px 24px", backdropFilter: "blur(8px)", boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)", transition: "all 0.3s" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", marginBottom: 12, fontWeight: 600 }}>{stat.label}</div>
            <div style={{ marginBottom: 6 }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{stat.sub}</div>
          </div>
        ))}
      </div>
      {/* Themes */}
      <div style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, marginBottom: 16 }}>Knowledge Domains</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {themeStats.map((theme: any, i: number) => {
            const due = claims.filter((c: any) => c.themes.includes(theme.name) && new Date(c.card.due) <= new Date()).length;
            return (
              <button key={theme.name} onClick={() => onThemeClick(theme.name)} style={{ background: `linear-gradient(135deg, ${theme.bg} 0%, rgba(12,12,15,0.95) 100%)`, border: `1px solid ${theme.accent}22`, borderRadius: 12, padding: "20px 24px", cursor: "pointer", textAlign: "left", transition: "all 0.3s", position: "relative", overflow: "hidden", fontFamily: "inherit", animation: `fadeSlideIn 0.4s ease ${i * 0.08}s both`, boxShadow: `0 4px 24px rgba(0,0,0,0.2), 0 0 0 0 ${theme.accent}00`, backdropFilter: "blur(8px)" }} onMouseEnter={(e: any) => { e.currentTarget.style.boxShadow = `0 8px 32px rgba(0,0,0,0.3), 0 0 20px ${theme.accent}15`; e.currentTarget.style.borderColor = `${theme.accent}44`; }} onMouseLeave={(e: any) => { e.currentTarget.style.boxShadow = `0 4px 24px rgba(0,0,0,0.2)`; e.currentTarget.style.borderColor = `${theme.accent}22`; }}>
                <div style={{ position: "absolute", top: 0, right: 0, width: 120, height: 120, background: `radial-gradient(circle at top right, ${theme.accent}08, transparent)` }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div><span style={{ fontSize: 22, marginRight: 10 }}>{theme.icon}</span><span style={{ fontSize: 16, fontWeight: 600, color: "#e4e4e7" }}>{theme.name}</span></div>
                  <RetentionRing value={theme.retention} size={40} color={theme.accent} />
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                  <span>{theme.sources} sources</span><span>{theme.claims} claims</span>
                  {theme.contradictions > 0 && <span style={{ color: "#ff4081" }}>⚡ {theme.contradictions}</span>}
                  {due > 0 && <span style={{ color: "#ffd600" }}>↻ {due} due</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {/* Recent */}
      <div>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, marginBottom: 16 }}>Recent Activity</h2>
        {recent.map((s: any) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "14px 20px", marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>{SOURCE_ICONS[s.type] || "📝"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.author} · {s.date}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {s.themes.slice(0, 2).map((t: string) => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${tc(t).accent}15`, color: tc(t).accent, border: `1px solid ${tc(t).accent}25` }}>{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Theme Detail View
// ============================================================
function ThemeDetailView({ theme, sources, claims, FSRS, onBack, onStartReview, tc }: any) {
  const colors = tc(theme);
  const ts = sources.filter((s: any) => s.themes.includes(theme));
  const tClaims = claims.filter((c: any) => c.themes.includes(theme));
  const consensus = tClaims.filter((c: any) => c.status === "consensus" || c.status === "supported");
  const emerging = tClaims.filter((c: any) => c.status === "emerging");
  const contested = tClaims.filter((c: any) => c.status === "contested" || c.contradicts?.length > 0);
  const due = tClaims.filter((c: any) => new Date(c.card.due) <= new Date()).length;
  const ret = tClaims.length > 0 ? tClaims.reduce((s: number, c: any) => s + FSRS.getRetrievability(c.card), 0) / tClaims.length : 0;

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 13, marginBottom: 20, padding: 0, fontFamily: "inherit" }}>← Back to Dashboard</button>
      <div style={{ background: `linear-gradient(135deg, ${colors.bg}, #0e2848)`, border: `1px solid ${colors.accent}22`, borderRadius: 16, padding: "32px 36px", marginBottom: 32, position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 36, marginRight: 16 }}>{colors.icon}</span>
            <span style={{ fontSize: 32, fontWeight: 800, fontFamily: "'Outfit', sans-serif", background: `linear-gradient(135deg, #e4e4e7, ${colors.accent})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{theme}</span>
            <div style={{ marginTop: 12, display: "flex", gap: 20, fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
              <span>{ts.length} sources</span><span>{tClaims.length} claims</span><span>{consensus.length} consensus</span>
              {contested.length > 0 && <span style={{ color: "#ff4081" }}>⚡ {contested.length} debated</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <RetentionRing value={ret} size={72} color={colors.accent} />
            {due > 0 && <button onClick={onStartReview} style={{ padding: "10px 24px", borderRadius: 8, background: `${colors.accent}20`, border: `1px solid ${colors.accent}40`, color: colors.accent, fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Review {due} Due ↻</button>}
          </div>
        </div>
      </div>
      {[{ title: "Consensus & Supported", items: consensus, color: "#00e676" }, { title: "Emerging", items: emerging, color: "#ffd600" }, { title: "Debated", items: contested, color: "#ff4081" }].map(g => g.items.length > 0 && (
        <div key={g.title} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: g.color, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} /> {g.title} ({g.items.length})</h3>
          {g.items.map((claim: any) => <ClaimCard key={claim.id} claim={claim} FSRS={FSRS} accentColor={g.color} claims={claims} />)}
        </div>
      ))}
      <div>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, marginBottom: 12 }}>Sources ({ts.length})</h3>
        {ts.map((s: any) => (
          <div key={s.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 20px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 18 }}>{SOURCE_ICONS[s.type] || "📝"}</span><div><div style={{ fontSize: 14, fontWeight: 500 }}>{s.title}</div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{s.author} · {s.date}</div></div></div>
            {s.summary && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, margin: "8px 0 0" }}>{s.summary}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClaimCard({ claim, FSRS, accentColor, claims }: any) {
  const ret = FSRS.getRetrievability(claim.card);
  const sources = claim.sourceDetails || [];
  const contras = claim.contradictionDetails || [];
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 20px", marginBottom: 8, borderLeft: `3px solid ${accentColor}40` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: "#e4e4e7", lineHeight: 1.5, margin: "0 0 8px" }}>"{claim.text}"</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={claim.status} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{sources.map((s: any) => `${SOURCE_ICONS[s.type] || "📝"} ${(s.author || "").split(" ").pop()}`).join(" · ")}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <RetentionRing value={ret} size={36} color={accentColor} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>recall</span>
        </div>
      </div>
      <div style={{ marginTop: 10 }}><ConfidenceBar value={claim.confidence} color={accentColor} /></div>
      {contras.length > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,64,129,0.04)", borderRadius: 6, borderLeft: "2px solid rgba(255,64,129,0.3)" }}>
          <div style={{ fontSize: 10, color: "#ff4081", fontWeight: 600, marginBottom: 4 }}>⚡ CONTRADICTS:</div>
          {contras.map((cc: any) => <div key={cc.id} style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>"{cc.text}" <StatusBadge status={cc.status || "contested"} /></div>)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Library View
// ============================================================
function LibraryView({ sources, claims, selectedSource, onSelectSource, tc }: any) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sourceDetail, setSourceDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const filtered = sources.filter((s: any) => { if (filter !== "all" && s.type !== filter) return false; if (search && !s.title.toLowerCase().includes(search.toLowerCase()) && !s.author.toLowerCase().includes(search.toLowerCase())) return false; return true; });
  const grouped = groupBy(filtered, (s: any) => { const diff = (Date.now() - new Date(s.date).getTime()) / 86400000; if (diff < 7) return "This Week"; if (diff < 30) return "This Month"; return "Earlier"; });

  const handleSelectSource = async (s: any) => {
    if (selectedSource?.id === s.id) {
      onSelectSource(null);
      setSourceDetail(null);
      setShowTranscript(false);
      return;
    }
    onSelectSource(s);
    setSourceDetail(null);
    setShowTranscript(false);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/content/${s.id}`);
      const data = res.ok ? await res.json() : null;
      if (data?.success) setSourceDetail(data.data);
    } catch (_e) { /* ignore */ }
    setDetailLoading(false);
  };

  const detailClaims = sourceDetail?.claims?.map((cs: any) => ({
    ...cs.claim,
    supportingQuote: cs.extractedText || "",
  })) || [];

  const keyTakeaways = sourceDetail?.keyTakeaways ? (() => {
    try { return JSON.parse(sourceDetail.keyTakeaways); } catch { return []; }
  })() : [];

  return (
    <div style={{ display: "flex", gap: 24 }}>
      {/* Source list */}
      <div style={{ flex: selectedSource ? "0 0 380px" : 1, transition: "all 0.3s" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>Content Library</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 28 }}>{sources.length} items</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          {["all", "podcast", "paper", "article", "book"].map(type => (
            <button key={type} onClick={() => setFilter(type)} style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: filter === type ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.04)", border: filter === type ? "1px solid rgba(0,229,255,0.3)" : "1px solid rgba(255,255,255,0.08)", color: filter === type ? "#00e5ff" : "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit" }}>
              {type === "all" ? "All" : `${SOURCE_ICONS[type] || "📝"} ${type.charAt(0).toUpperCase() + type.slice(1)}s`}
            </button>
          ))}
          {!selectedSource && <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ marginLeft: "auto", padding: "6px 16px", borderRadius: 20, fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#e4e4e7", outline: "none", width: 200, fontFamily: "inherit" }} />}
        </div>
        {Object.entries(grouped).map(([period, items]: [string, any]) => (
          <div key={period} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 10, fontWeight: 600 }}>{period}</h3>
            {(items as any[]).map((s: any) => (
              <div key={s.id} onClick={() => handleSelectSource(s)} style={{ background: selectedSource?.id === s.id ? "rgba(0,229,255,0.04)" : "rgba(255,255,255,0.02)", border: selectedSource?.id === s.id ? "1px solid rgba(0,229,255,0.15)" : "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 20px", marginBottom: 8, cursor: "pointer", transition: "all 0.2s" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <span style={{ fontSize: 24, marginTop: 2 }}>{SOURCE_ICONS[s.type] || "📝"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>{s.author} · {s.date} · {s.claimCount} claims</div>
                    {!selectedSource && <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, margin: 0 }}>{s.summary}</p>}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {s.themes.map((t: string) => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${tc(t).accent}15`, color: tc(t).accent, border: `1px solid ${tc(t).accent}25` }}>{t}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selectedSource && (
        <div style={{ flex: 1, minWidth: 0, animation: "fadeSlideIn 0.3s ease" }}>
          <div style={{ position: "sticky", top: 0 }}>
            {/* Header */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,229,255,0.1)", borderRadius: 12, padding: "24px 28px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 28 }}>{SOURCE_ICONS[selectedSource.type] || "📝"}</span>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: "'Outfit', sans-serif" }}>{selectedSource.title}</h2>
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>{selectedSource.author} · {selectedSource.date}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selectedSource.themes.map((t: string) => <span key={t} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 10, background: `${tc(t).accent}15`, color: tc(t).accent, border: `1px solid ${tc(t).accent}25` }}>{t}</span>)}
                  </div>
                </div>
                <button onClick={() => { onSelectSource(null); setSourceDetail(null); }} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 6, padding: "4px 10px", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>✕</button>
              </div>
              {selectedSource.url && <a href={selectedSource.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#00e5ff", textDecoration: "none", display: "inline-block", marginTop: 12, opacity: 0.7 }}>View original →</a>}
            </div>

            {detailLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, color: "rgba(255,255,255,0.3)" }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                <span style={{ marginLeft: 10, fontSize: 13 }}>Loading details...</span>
              </div>
            ) : sourceDetail ? (
              <div style={{ maxHeight: "calc(100vh - 240px)", overflow: "auto" }}>
                {/* Summary */}
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 10, fontWeight: 600 }}>Summary</h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{sourceDetail.summary}</p>
                </div>

                {/* Key Takeaways */}
                {keyTakeaways.length > 0 && (
                  <div style={{ background: "rgba(0,229,255,0.03)", border: "1px solid rgba(0,229,255,0.08)", borderRadius: 12, padding: "20px 24px", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#00e5ff", marginBottom: 12, fontWeight: 600 }}>Key Takeaways</h3>
                    {keyTakeaways.map((t: string, i: number) => (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                        <span style={{ color: "#00e5ff", fontSize: 12, marginTop: 2, flexShrink: 0 }}>◆</span>
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, margin: 0 }}>{t}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Claims */}
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 14, fontWeight: 600 }}>
                    Claims Extracted ({detailClaims.length})
                  </h3>
                  {detailClaims.map((claim: any, i: number) => (
                    <div key={claim.id || i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < detailClaims.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono'", marginTop: 2, flexShrink: 0 }}>{i + 1}.</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5, margin: "0 0 8px", color: "#e4e4e7" }}>"{claim.text}"</p>
                          {claim.explanation && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, margin: "0 0 8px" }}>{claim.explanation}</p>}
                          {claim.implications && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.5, margin: "0 0 8px", fontStyle: "italic" }}>→ {claim.implications}</p>}
                          {claim.supportingQuote && (
                            <div style={{ background: "rgba(124,77,255,0.05)", borderLeft: "2px solid rgba(124,77,255,0.3)", padding: "8px 12px", borderRadius: "0 6px 6px 0", marginTop: 8 }}>
                              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(124,77,255,0.6)", marginBottom: 4, fontWeight: 600 }}>Supporting Quote</div>
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, margin: 0, fontStyle: "italic" }}>"{claim.supportingQuote}"</p>
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                            <StatusBadge status={(claim.status || "emerging").toLowerCase()} />
                            <ConfidenceBar value={claim.confidence} color="#7c4dff" />
                            {claim.themes?.map((ct: any) => (
                              <span key={ct.theme?.id || ct.themeId} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${tc(ct.theme?.name).accent}12`, color: tc(ct.theme?.name).accent }}>{ct.theme?.name}</span>
                            ))}
                          </div>
                          {(claim.contradicts?.length > 0 || claim.contradictedBy?.length > 0) && (
                            <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,64,129,0.05)", borderRadius: 6, borderLeft: "2px solid rgba(255,64,129,0.3)" }}>
                              <div style={{ fontSize: 9, color: "#ff4081", fontWeight: 600, marginBottom: 2 }}>⚡ CONTRADICTIONS</div>
                              {claim.contradicts?.map((c: any) => <div key={c.contradicted?.id} style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>vs: "{c.contradicted?.text?.slice(0, 80)}..."</div>)}
                              {claim.contradictedBy?.map((c: any) => <div key={c.claim?.id} style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>vs: "{c.claim?.text?.slice(0, 80)}..."</div>)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Transcript */}
                {sourceDetail.rawText && (
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", marginBottom: 12 }}>
                    <button onClick={() => setShowTranscript(!showTranscript)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, width: "100%" }}>
                      <h3 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", margin: 0, fontWeight: 600 }}>
                        {selectedSource.type === "podcast" ? "Full Transcript" : "Source Text"} ({Math.round(sourceDetail.rawText.length / 1000)}k chars)
                      </h3>
                      <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>{showTranscript ? "▾" : "▸"}</span>
                    </button>
                    {showTranscript && (
                      <div style={{ marginTop: 14, maxHeight: 500, overflow: "auto", padding: "16px", background: "rgba(0,0,0,0.15)", borderRadius: 8 }}>
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap", fontFamily: "'JetBrains Mono', monospace" }}>
                          {sourceDetail.rawText}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Claims View
// ============================================================
function ClaimsView({ claims, sources, FSRS, tc }: any) {
  const [sortBy, setSortBy] = useState("confidence");
  const sorted = [...claims].sort((a: any, b: any) => { if (sortBy === "confidence") return b.confidence - a.confidence; if (sortBy === "retention") return FSRS.getRetrievability(b.card) - FSRS.getRetrievability(a.card); return a.status.localeCompare(b.status); });
  const groups = groupBy(sorted, (c: any) => c.status);

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>Claims Database</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 28 }}>{claims.length} discrete claims tracked</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {["confidence", "retention", "status"].map(s => (
          <button key={s} onClick={() => setSortBy(s)} style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: sortBy === s ? "rgba(124,77,255,0.12)" : "rgba(255,255,255,0.04)", border: sortBy === s ? "1px solid rgba(124,77,255,0.3)" : "1px solid rgba(255,255,255,0.08)", color: sortBy === s ? "#7c4dff" : "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit" }}>Sort by {s}</button>
        ))}
      </div>
      {Object.entries(groups).map(([status, items]: [string, any]) => (
        <div key={status} style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><StatusBadge status={status} /><span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>({(items as any[]).length})</span></div>
          {(items as any[]).map((claim: any) => (
            <div key={claim.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "16px 20px", marginBottom: 8 }}>
              <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5, margin: "0 0 10px" }}>"{claim.text}"</p>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6 }}>{claim.themes.map((t: string) => <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${tc(t).accent}12`, color: tc(t).accent }}>{t}</span>)}</div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                  <ConfidenceBar value={claim.confidence} color="#7c4dff" />
                  <RetentionRing value={FSRS.getRetrievability(claim.card)} size={32} color="#00e5ff" />
                </div>
              </div>
              {claim.contradictionDetails?.length > 0 && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,64,129,0.05)", borderRadius: 6, borderLeft: "2px solid rgba(255,64,129,0.3)" }}>
                  <div style={{ fontSize: 10, color: "#ff4081", fontWeight: 600, marginBottom: 4 }}>⚡ CONTRADICTS:</div>
                  {claim.contradictionDetails.map((cc: any) => <div key={cc.id} style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>"{cc.text}"</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Ingest View
// ============================================================
function IngestView({ url, setUrl, step, onSubmit, statusMessage }: any) {
  const steps = ["Submitting...", "Fetching content...", "Extracting text...", "AI processing claims...", "Building knowledge graph...", "Complete!"];
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif" }}>Add Content</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 12 }}>Paste a paper DOI, article URL, or web link</p>
      <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginBottom: 32 }}>💡 For podcasts, use: <code style={{ color: "#00e5ff", background: "rgba(0,229,255,0.06)", padding: "2px 6px", borderRadius: 4 }}>npx tsx scripts/ingest-podcast.ts "YOUTUBE_URL"</code></p>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "32px 36px", maxWidth: 640, marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <input value={url} onChange={(e: any) => setUrl(e.target.value)} placeholder="Paste URL or DOI..." disabled={step > 0 && step < 6} style={{ flex: 1, padding: "12px 18px", borderRadius: 10, fontSize: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#e4e4e7", outline: "none", fontFamily: "inherit" }} onKeyDown={(e: any) => e.key === "Enter" && onSubmit()} />
          <button onClick={onSubmit} disabled={step > 0 && step < 6} style={{ padding: "12px 28px", borderRadius: 10, fontSize: 14, fontWeight: 600, background: step === 0 ? "linear-gradient(135deg, #00e5ff, #7c4dff)" : "rgba(255,255,255,0.06)", border: "none", color: step === 0 ? "#000" : "rgba(255,255,255,0.3)", cursor: step === 0 ? "pointer" : "default", fontFamily: "inherit" }}>{step === 0 ? "Process" : "Processing..."}</button>
        </div>
        {step > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20 }}>
            {statusMessage && <div style={{ fontSize: 13, color: "#00e5ff", marginBottom: 12 }}>{statusMessage}</div>}
            {steps.map((label: any, i: number) => { const idx = i + 1; const active = idx === step; const done = idx < step; return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", borderRadius: 8, marginBottom: 4, background: active ? "rgba(0,229,255,0.06)" : "transparent", opacity: done || active ? 1 : 0.3 }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: done ? "rgba(0,230,118,0.15)" : active ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.04)", border: done ? "1px solid rgba(0,230,118,0.3)" : active ? "1px solid rgba(0,229,255,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>{done ? "✓" : idx}</span>
                <span style={{ fontSize: 13, color: done ? "#00e676" : active ? "#00e5ff" : "rgba(255,255,255,0.4)", fontWeight: active ? 600 : 400 }}>{label}</span>
                {active && <span style={{ marginLeft: "auto", width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.3)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite" }} />}
              </div>
            ); })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Review View
// ============================================================
function ReviewView({ claim, index, total, showAnswer, onReveal, onRate, sources, claims, FSRS, tc }: any) {
  const themeColor = tc(claim.themes[0])?.accent || "#00e5ff";
  const promptType = ["recall", "reflection", "correlation"][index % 3];
  const questions: Record<string, string> = { recall: "What does the evidence say about:", reflection: "Do you still agree with this claim?", correlation: "How does this connect to what you know?" };
  const claimSources = claim.sourceDetails || [];
  const contras = claim.contradictionDetails || [];

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 36 }}>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}><div style={{ width: `${((index + 1) / total) * 100}%`, height: "100%", background: themeColor, borderRadius: 2, transition: "width 0.4s" }} /></div>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono'" }}>{index + 1} / {total}</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", padding: "4px 12px", borderRadius: 20, background: promptType === "recall" ? "rgba(0,229,255,0.1)" : promptType === "reflection" ? "rgba(124,77,255,0.1)" : "rgba(255,214,0,0.1)", color: promptType === "recall" ? "#00e5ff" : promptType === "reflection" ? "#7c4dff" : "#ffd600" }}>{promptType} prompt</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "36px 32px", marginBottom: 24, borderTop: `3px solid ${themeColor}` }}>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 16, fontWeight: 500 }}>{questions[promptType]}</div>
        <p style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.5, margin: 0, color: "#e4e4e7" }}>"{claim.text}"</p>
        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>{claim.themes.map((t: string) => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${tc(t).accent}12`, color: tc(t).accent }}>{t}</span>)}</div>
      </div>
      {!showAnswer ? (
        <button onClick={onReveal} style={{ width: "100%", padding: "16px", borderRadius: 12, fontSize: 15, fontWeight: 600, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontFamily: "inherit" }}>Show Sources & Context ↓</button>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", marginBottom: 24, animation: "fadeSlideIn 0.3s ease" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 12, fontWeight: 600 }}>Supporting Evidence</div>
          {claimSources.map((s: any) => (
            <div key={s.id} style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span>{SOURCE_ICONS[s.type] || "📝"}</span><span style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</span></div>
              {s.supportingQuote && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, margin: "4px 0 0", fontStyle: "italic" }}>"{s.supportingQuote}"</p>}
              {!s.supportingQuote && s.summary && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, margin: 0 }}>{s.summary}</p>}
            </div>
          ))}
          {contras.length > 0 && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(255,64,129,0.04)", borderRadius: 8, border: "1px solid rgba(255,64,129,0.1)" }}>
              <div style={{ fontSize: 11, color: "#ff4081", fontWeight: 600, marginBottom: 6 }}>⚡ COUNTERPOINT</div>
              {contras.map((cc: any) => <p key={cc.id} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>"{cc.text}"</p>)}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <ConfidenceBar value={claim.confidence} color={themeColor} />
            <StatusBadge status={claim.status} />
          </div>
        </div>
      )}
      {showAnswer && (
        <div style={{ animation: "fadeSlideIn 0.3s ease 0.1s both" }}>
          <div style={{ fontSize: 12, textAlign: "center", color: "rgba(255,255,255,0.3)", marginBottom: 12, fontWeight: 500 }}>How well did you recall this?</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { rating: 1, label: "Again", sub: "< 1 day", color: "#ff1744", bg: "rgba(255,23,68,0.08)" },
              { rating: 2, label: "Hard", sub: "~1 day", color: "#ff9100", bg: "rgba(255,145,0,0.08)" },
              { rating: 3, label: "Good", sub: `~${Math.round((claim.card.stability || 1) * 2.5)} days`, color: "#00e676", bg: "rgba(0,230,118,0.08)" },
              { rating: 4, label: "Easy", sub: `~${Math.round((claim.card.stability || 1) * 3.5)} days`, color: "#00e5ff", bg: "rgba(0,229,255,0.08)" },
            ].map(btn => (
              <button key={btn.rating} onClick={() => onRate(btn.rating)} style={{ padding: "14px 8px", borderRadius: 10, cursor: "pointer", background: btn.bg, border: `1px solid ${btn.color}30`, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: btn.color }}>{btn.label}</span>
                <span style={{ fontSize: 10, color: `${btn.color}80` }}>{btn.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Knowledge Graph View
// ============================================================
interface GNode {
  id: string; type: "theme" | "claim" | "source"; label: string; sublabel?: string;
  color: string; radius: number; x: number; y: number; vx: number; vy: number;
  status?: string; confidence?: number; themes?: string[];
}
interface GLink { source: string; target: string; type: "theme-claim" | "claim-source" | "contradiction"; color: string; dashed?: boolean; }

function GraphView({ claims, sources, themeStats, tc, FSRS }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [links, setLinks] = useState<GLink[]>([]);
  const [hovered, setHovered] = useState<GNode | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const frameRef = useRef<number>(0);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef<{ node: GNode | null; offsetX: number; offsetY: number; isPanning: boolean; startX: number; startY: number }>({ node: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0 });

  // Build graph data from claims/sources/themes
  useEffect(() => {
    const gNodes: GNode[] = [];
    const gLinks: GLink[] = [];
    const nodeIds = new Set<string>();

    // Theme nodes
    themeStats.forEach((t: any) => {
      gNodes.push({ id: `t-${t.name}`, type: "theme", label: `${t.icon} ${t.name}`, color: t.accent, radius: 28, x: Math.random() * 800 + 100, y: Math.random() * 600 + 100, vx: 0, vy: 0 });
      nodeIds.add(`t-${t.name}`);
    });

    // Claim nodes
    claims.forEach((c: any) => {
      const primaryTheme = c.themes[0];
      const color = primaryTheme ? tc(primaryTheme).accent : "#666";
      gNodes.push({ id: `c-${c.id}`, type: "claim", label: c.text.length > 60 ? c.text.slice(0, 57) + "..." : c.text, sublabel: c.status, color, radius: 10 + (c.confidence || 0.5) * 8, x: Math.random() * 800 + 100, y: Math.random() * 600 + 100, vx: 0, vy: 0, status: c.status, confidence: c.confidence, themes: c.themes });
      nodeIds.add(`c-${c.id}`);

      // Link to themes
      (c.themes || []).forEach((themeName: string) => {
        const themeId = `t-${themeName}`;
        if (nodeIds.has(themeId)) {
          gLinks.push({ source: themeId, target: `c-${c.id}`, type: "theme-claim", color: `${tc(themeName).accent}40` });
        }
      });

      // Contradiction links
      (c.contradicts || []).forEach((cid: string) => {
        gLinks.push({ source: `c-${c.id}`, target: `c-${cid}`, type: "contradiction", color: "#ff4081", dashed: true });
      });
    });

    // Source nodes
    sources.forEach((s: any) => {
      const primaryTheme = s.themes[0];
      const color = primaryTheme ? tc(primaryTheme).accent : "#555";
      const icon = SOURCE_ICONS[s.type] || "📝";
      gNodes.push({ id: `s-${s.id}`, type: "source", label: `${icon} ${s.title.length > 40 ? s.title.slice(0, 37) + "..." : s.title}`, sublabel: s.author, color: `${color}80`, radius: 6, x: Math.random() * 800 + 100, y: Math.random() * 600 + 100, vx: 0, vy: 0, themes: s.themes });
      nodeIds.add(`s-${s.id}`);
    });

    // Link claims to sources
    claims.forEach((c: any) => {
      (c.sources || []).forEach((sid: string) => {
        if (nodeIds.has(`s-${sid}`)) {
          gLinks.push({ source: `c-${c.id}`, target: `s-${sid}`, type: "claim-source", color: "rgba(255,255,255,0.08)" });
        }
      });
    });

    setNodes(gNodes);
    setLinks(gLinks);
    nodesRef.current = gNodes;
    linksRef.current = gLinks;
  }, [claims, sources, themeStats]);

  // Force simulation + rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodesRef.current.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = canvas.parentElement?.clientWidth || 1000; canvas.height = canvas.parentElement?.clientHeight || 700; };
    resize();
    window.addEventListener("resize", resize);

    let running = true;
    const nodeMap = new Map<string, GNode>();
    nodesRef.current.forEach(n => nodeMap.set(n.id, n));

    const simulate = () => {
      if (!running) return;
      const ns = nodesRef.current;
      const ls = linksRef.current;
      const W = canvas.width;
      const H = canvas.height;
      const centerX = W / 2;
      const centerY = H / 2;

      // Force: repulsion between all nodes
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = (a.radius + b.radius) * 3;
          const strength = a.type === "theme" && b.type === "theme" ? 800 : 200;
          if (dist < minDist * 3) {
            const force = strength / (dist * dist);
            const fx = dx / dist * force, fy = dy / dist * force;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
      }

      // Force: attraction along links
      for (const link of ls) {
        const a = nodeMap.get(link.source), b = nodeMap.get(link.target);
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = link.type === "theme-claim" ? 120 : link.type === "contradiction" ? 180 : 80;
        const strength = link.type === "contradiction" ? 0.003 : 0.01;
        const force = (dist - idealDist) * strength;
        const fx = dx / dist * force, fy = dy / dist * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // Force: centering
      for (const n of ns) {
        n.vx += (centerX - n.x) * 0.0008;
        n.vy += (centerY - n.y) * 0.0008;
      }

      // Apply velocity with damping
      for (const n of ns) {
        if (dragRef.current.node?.id === n.id) continue;
        n.vx *= 0.92; n.vy *= 0.92;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(n.radius, Math.min(W - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(H - n.radius, n.y));
      }

      // Filter
      const activeTheme = filter !== "all" ? filter : null;
      const visibleNodes = activeTheme ? ns.filter(n => {
        if (n.type === "theme") return n.label.includes(activeTheme);
        return n.themes?.includes(activeTheme);
      }) : ns;
      const visibleIds = new Set(visibleNodes.map(n => n.id));
      const visibleLinks = ls.filter(l => visibleIds.has(l.source) && visibleIds.has(l.target));

      // Render
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(offsetRef.current.x, offsetRef.current.y);
      ctx.scale(scaleRef.current, scaleRef.current);

      // Draw links
      for (const link of visibleLinks) {
        const a = nodeMap.get(link.source), b = nodeMap.get(link.target);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.strokeStyle = link.color;
        ctx.lineWidth = link.type === "contradiction" ? 2 : 1;
        if (link.dashed) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Draw nodes
      for (const n of visibleNodes) {
        const isHovered = hovered?.id === n.id;
        const isSelected = selected?.id === n.id;

        // Glow
        if (isHovered || isSelected || n.type === "theme") {
          ctx.beginPath();
          const grad = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, n.radius * (isHovered ? 3 : 2));
          grad.addColorStop(0, n.color + "30");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.arc(n.x, n.y, n.radius * (isHovered ? 3 : 2), 0, Math.PI * 2);
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? n.color : n.type === "theme" ? n.color + "cc" : n.color + "80";
        ctx.fill();
        if (isHovered || isSelected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
        else if (n.type === "theme") { ctx.strokeStyle = n.color; ctx.lineWidth = 1.5; ctx.stroke(); }

        // Status ring for claims
        if (n.type === "claim" && n.status) {
          const statusColors: Record<string, string> = { consensus: "#00e676", supported: "#00e5ff", emerging: "#ffd600", contested: "#ff4081" };
          const sc = statusColors[n.status || ""] || "#666";
          ctx.beginPath(); ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = sc + "60"; ctx.lineWidth = 2; ctx.stroke();
        }

        // Labels for themes and hovered
        if (n.type === "theme" || isHovered) {
          ctx.fillStyle = "#e4e4e7";
          ctx.font = n.type === "theme" ? "bold 12px 'DM Sans', sans-serif" : "11px 'DM Sans', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y + n.radius + 16);
        }
      }

      ctx.restore();
      frameRef.current = requestAnimationFrame(simulate);
    };

    frameRef.current = requestAnimationFrame(simulate);
    return () => { running = false; cancelAnimationFrame(frameRef.current); window.removeEventListener("resize", resize); };
  }, [nodes, links, hovered, selected, filter]);

  // Mouse interaction
  const getNodeAt = useCallback((mx: number, my: number): GNode | null => {
    const sx = (mx - offsetRef.current.x) / scaleRef.current;
    const sy = (my - offsetRef.current.y) / scaleRef.current;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      const dx = sx - n.x, dy = sy - n.y;
      if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) return n;
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    if (dragRef.current.node) {
      const n = dragRef.current.node;
      n.x = (mx - offsetRef.current.x) / scaleRef.current;
      n.y = (my - offsetRef.current.y) / scaleRef.current;
      n.vx = 0; n.vy = 0;
      return;
    }
    if (dragRef.current.isPanning) {
      offsetRef.current.x += e.movementX;
      offsetRef.current.y += e.movementY;
      return;
    }

    const node = getNodeAt(mx, my);
    setHovered(node);
    if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "grab";
  }, [getNodeAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      dragRef.current = { node, offsetX: 0, offsetY: 0, isPanning: false, startX: mx, startY: my };
    } else {
      dragRef.current = { node: null, offsetX: 0, offsetY: 0, isPanning: true, startX: mx, startY: my };
    }
  }, [getNodeAt]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const moved = Math.abs(mx - dragRef.current.startX) + Math.abs(my - dragRef.current.startY);
    if (moved < 5) {
      const node = getNodeAt(mx, my);
      setSelected(prev => prev?.id === node?.id ? null : node);
    }
    dragRef.current = { node: null, offsetX: 0, offsetY: 0, isPanning: false, startX: 0, startY: 0 };
  }, [getNodeAt]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    scaleRef.current = Math.max(0.3, Math.min(3, scaleRef.current * delta));
  }, []);

  const allThemes = themeStats.map((t: any) => t.name);
  const selectedClaim = selected?.type === "claim" ? claims.find((c: any) => `c-${c.id}` === selected.id) : null;
  const selectedSource = selected?.type === "source" ? sources.find((s: any) => `s-${s.id}` === selected.id) : null;

  return (
    <div style={{ position: "relative", height: "calc(100vh - 64px)", margin: "-32px -40px", display: "flex" }}>
      {/* Graph Canvas */}
      <div style={{ flex: 1, position: "relative", background: "#06060a" }}>
        <canvas ref={canvasRef} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onWheel={handleWheel} style={{ width: "100%", height: "100%", cursor: "grab" }} />

        {/* Legend + Filter */}
        <div style={{ position: "absolute", top: 20, left: 20, background: "rgba(9,9,11,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "16px 20px", backdropFilter: "blur(12px)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 12px", fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #00e5ff, #7c4dff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Knowledge Graph</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {[{ label: "Theme", color: "#00e5ff", r: 10 }, { label: "Claim", color: "#888", r: 7 }, { label: "Source", color: "#555", r: 4 }].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                <span style={{ width: item.r * 2, height: item.r * 2, borderRadius: "50%", background: item.color, display: "inline-block", flexShrink: 0 }} />
                {item.label}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              <span style={{ width: 20, height: 2, background: "#ff4081", display: "inline-block", borderTop: "2px dashed #ff4081" }} />
              Contradiction
            </div>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 12 }}>Scroll to zoom · Drag to pan · Click nodes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button onClick={() => setFilter("all")} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, background: filter === "all" ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.04)", border: filter === "all" ? "1px solid rgba(0,229,255,0.3)" : "1px solid rgba(255,255,255,0.06)", color: filter === "all" ? "#00e5ff" : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>All themes</button>
            {allThemes.map((t: string) => (
              <button key={t} onClick={() => setFilter(t === filter ? "all" : t)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, background: filter === t ? `${tc(t).accent}20` : "rgba(255,255,255,0.04)", border: filter === t ? `1px solid ${tc(t).accent}40` : "1px solid rgba(255,255,255,0.06)", color: filter === t ? tc(t).accent : "rgba(255,255,255,0.4)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>{tc(t).icon} {t}</button>
            ))}
          </div>
        </div>

        {/* Stats overlay */}
        <div style={{ position: "absolute", top: 20, right: 20, background: "rgba(9,9,11,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 16px", backdropFilter: "blur(12px)" }}>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            <span><strong style={{ color: "#00e5ff" }}>{themeStats.length}</strong> themes</span>
            <span><strong style={{ color: "#7c4dff" }}>{claims.length}</strong> claims</span>
            <span><strong style={{ color: "#555" }}>{sources.length}</strong> sources</span>
            <span><strong style={{ color: "#ff4081" }}>{claims.reduce((s: number, c: any) => s + (c.contradicts?.length || 0), 0)}</strong> contradictions</span>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {(selected || hovered) && (
        <div style={{ width: 320, background: "#0d2544", borderLeft: "1px solid rgba(255,255,255,0.06)", padding: "24px 20px", overflow: "auto", animation: "fadeSlideIn 0.2s ease" }}>
          {(() => {
            const node = selected || hovered;
            if (!node) return null;

            if (node.type === "theme") {
              const theme = themeStats.find((t: any) => `t-${t.name}` === node.id);
              if (!theme) return null;
              return (
                <div>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{theme.icon}</div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: theme.accent }}>{theme.name}</h3>
                  <div style={{ display: "flex", gap: 12, fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                    <span>{theme.sources} sources</span><span>{theme.claims} claims</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, textTransform: "uppercase" }}>Retention</div>
                    <RetentionRing value={theme.retention} size={56} color={theme.accent} />
                  </div>
                  {theme.contradictions > 0 && <div style={{ fontSize: 12, color: "#ff4081" }}>⚡ {theme.contradictions} active debates</div>}
                </div>
              );
            }

            if (selectedClaim) {
              return (
                <div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                    <StatusBadge status={selectedClaim.status} />
                    <ConfidenceBar value={selectedClaim.confidence} color={node.color} />
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.6, margin: "0 0 16px", color: "#e4e4e7" }}>"{selectedClaim.text}"</p>
                  {selectedClaim.explanation && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginBottom: 12 }}>{selectedClaim.explanation}</p>}
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6, textTransform: "uppercase" }}>Themes</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                    {selectedClaim.themes.map((t: string) => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${tc(t).accent}15`, color: tc(t).accent }}>{t}</span>)}
                  </div>
                  {selectedClaim.sourceDetails?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6, textTransform: "uppercase" }}>Sources</div>
                      {selectedClaim.sourceDetails.map((s: any) => (
                        <div key={s.id} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, padding: "6px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                          {SOURCE_ICONS[s.type] || "📝"} {s.title}
                          {s.supportingQuote && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontStyle: "italic", marginTop: 4 }}>"{s.supportingQuote.slice(0, 120)}..."</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedClaim.contradictionDetails?.length > 0 && (
                    <div style={{ marginTop: 12, padding: "10px", background: "rgba(255,64,129,0.05)", borderRadius: 8, border: "1px solid rgba(255,64,129,0.15)" }}>
                      <div style={{ fontSize: 10, color: "#ff4081", fontWeight: 600, marginBottom: 6 }}>⚡ CONTRADICTS</div>
                      {selectedClaim.contradictionDetails.map((cc: any) => <div key={cc.id} style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>"{cc.text}"</div>)}
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, textTransform: "uppercase" }}>Recall</div>
                    <RetentionRing value={FSRS.getRetrievability(selectedClaim.card)} size={48} color={node.color} />
                  </div>
                </div>
              );
            }

            if (selectedSource) {
              return (
                <div>
                  <span style={{ fontSize: 28 }}>{SOURCE_ICONS[selectedSource.type] || "📝"}</span>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: "8px 0", color: "#e4e4e7" }}>{selectedSource.title}</h3>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>{selectedSource.author} · {selectedSource.date}</div>
                  {selectedSource.summary && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginBottom: 12 }}>{selectedSource.summary}</p>}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {selectedSource.themes.map((t: string) => <span key={t} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${tc(t).accent}15`, color: tc(t).accent }}>{t}</span>)}
                  </div>
                </div>
              );
            }

            // Hovered but not selected — show compact info
            return (
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 4, textTransform: "uppercase" }}>{node.type}</div>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#e4e4e7", lineHeight: 1.5, margin: 0 }}>{node.label}</p>
                {node.sublabel && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "4px 0 0" }}>{node.sublabel}</p>}
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 12 }}>Click for details</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Analytics View
// ============================================================
function AnalyticsView({ tc }: any) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [retentionTheme, setRetentionTheme] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics").then(r => r.ok ? r.json() : { success: false }).then(d => { if (d.success) setData(d.data); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!data) return <div style={{ color: "rgba(255,255,255,0.3)", padding: 40 }}>No analytics data yet. Complete some reviews first.</div>;

  const { overview, heatmap, retentionByDay, growthByDay, statusCounts, sourceTypeCounts, ratingDistribution, hardClaims } = data;

  // Heatmap: last 12 weeks
  const heatmapDays = Object.entries(heatmap).sort(([a], [b]) => a.localeCompare(b)).slice(-84);
  const maxReviews = Math.max(1, ...heatmapDays.map(([, d]: any) => d.count));
  const weeks: any[][] = [];
  for (let i = 0; i < heatmapDays.length; i += 7) weeks.push(heatmapDays.slice(i, i + 7));

  // Retention chart dimensions
  const chartW = 600, chartH = 160, chartPad = 40;
  const retentionPoints = retentionByDay.map((d: any, i: number) => {
    const x = chartPad + (i / (retentionByDay.length - 1)) * (chartW - chartPad * 2);
    const val = retentionTheme ? (d.byTheme[retentionTheme] || 0) : d.overall;
    const y = chartH - chartPad - val * (chartH - chartPad * 2);
    return { x, y, date: d.date, value: val };
  });
  const retentionPath = retentionPoints.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const retentionFill = retentionPath + ` L ${retentionPoints[retentionPoints.length - 1]?.x} ${chartH - chartPad} L ${chartPad} ${chartH - chartPad} Z`;
  const allRetThemes = [...new Set(retentionByDay.flatMap((d: any) => Object.keys(d.byTheme)))];

  // Growth chart
  const maxClaims = Math.max(1, ...growthByDay.map((d: any) => d.claims));
  const maxSources = Math.max(1, ...growthByDay.map((d: any) => d.sources));
  const growthClaimPoints = growthByDay.map((d: any, i: number) => {
    const x = chartPad + (i / (growthByDay.length - 1)) * (chartW - chartPad * 2);
    const y = chartH - chartPad - (d.claims / maxClaims) * (chartH - chartPad * 2);
    return { x, y };
  });
  const growthSourcePoints = growthByDay.map((d: any, i: number) => {
    const x = chartPad + (i / (growthByDay.length - 1)) * (chartW - chartPad * 2);
    const y = chartH - chartPad - (d.sources / maxSources) * (chartH - chartPad * 2);
    return { x, y };
  });
  const claimPath = growthClaimPoints.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const sourcePath = growthSourcePoints.map((p: any, i: number) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Rating donut
  const ratingColors = ["#ff1744", "#ff9100", "#00e676", "#00e5ff"];
  const ratingLabels = ["Again", "Hard", "Good", "Easy"];
  const ratingValues = [ratingDistribution.again, ratingDistribution.hard, ratingDistribution.good, ratingDistribution.easy];
  const ratingTotal = ratingDistribution.total || 1;
  let ratingAngle = 0;

  // Status bar widths
  const statusTotal = Object.values(statusCounts).reduce((a: number, b: any) => a + b, 0) || 1;
  const statusColors: Record<string, string> = { consensus: "#00e676", supported: "#00e5ff", emerging: "#ffd600", contested: "#ff4081", contradicted: "#ff1744" };

  return (
    <div>
      <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0, letterSpacing: "-0.03em", fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #e4e4e7 30%, rgba(228,228,231,0.5))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", textShadow: "0 0 40px rgba(0,229,255,0.15)" }}>Analytics</h1>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 8, marginBottom: 32 }}>Your learning performance and knowledge growth</p>

      {/* Top stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 32 }}>
        {[
          { label: "Current Streak", value: `${overview.currentStreak}d`, color: overview.currentStreak > 0 ? "#ffd600" : "rgba(255,255,255,0.3)", sub: `Best: ${overview.longestStreak}d` },
          { label: "Overall Retention", value: `${Math.round(overview.currentRetention * 100)}%`, color: overview.currentRetention > 0.8 ? "#00e676" : overview.currentRetention > 0.5 ? "#ffd600" : "#ff4081", sub: "across all claims" },
          { label: "Total Reviews", value: overview.totalReviews, color: "#7c4dff", sub: `${overview.avgReviewsPerDay}/day avg` },
          { label: "Knowledge Base", value: overview.totalClaims, color: "#00e5ff", sub: `${overview.totalSources} sources · ${overview.totalThemes} themes` },
          { label: "Due Now", value: overview.dueNow, color: overview.dueNow > 0 ? "#ff9100" : "#00e676", sub: overview.dueNow > 0 ? "ready for review" : "all caught up" },
        ].map((s: any, i: number) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 20px", animation: `fadeSlideIn 0.4s ease ${i * 0.06}s both` }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono'" }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Review Heatmap */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", marginBottom: 24, animation: "fadeSlideIn 0.4s ease 0.3s both" }}>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 16px" }}>Review Activity — Last 12 Weeks</h3>
        <div style={{ display: "flex", gap: 3 }}>
          {weeks.map((week: any, wi: number) => (
            <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {week.map(([date, d]: any) => {
                const intensity = d.count / maxReviews;
                return (
                  <div key={date} title={`${date}: ${d.count} reviews`} style={{ width: 14, height: 14, borderRadius: 3, background: d.count === 0 ? "rgba(255,255,255,0.04)" : `rgba(0,229,255,${0.15 + intensity * 0.85})`, cursor: "default", transition: "transform 0.1s" }} />
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map(v => <div key={v} style={{ width: 10, height: 10, borderRadius: 2, background: v === 0 ? "rgba(255,255,255,0.04)" : `rgba(0,229,255,${0.15 + v * 0.85})` }} />)}
          <span>More</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* Retention Over Time */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.4s both" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: 0 }}>Retention — 30 Days</h3>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setRetentionTheme(null)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, background: !retentionTheme ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.04)", border: !retentionTheme ? "1px solid rgba(0,229,255,0.3)" : "1px solid rgba(255,255,255,0.06)", color: !retentionTheme ? "#00e5ff" : "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "inherit" }}>All</button>
              {allRetThemes.slice(0, 4).map((t: any) => (
                <button key={t} onClick={() => setRetentionTheme(retentionTheme === t ? null : t)} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 9, background: retentionTheme === t ? `${tc(t).accent}20` : "rgba(255,255,255,0.04)", border: retentionTheme === t ? `1px solid ${tc(t).accent}40` : "1px solid rgba(255,255,255,0.06)", color: retentionTheme === t ? tc(t).accent : "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: "inherit" }}>{t.length > 12 ? t.slice(0, 10) + "…" : t}</button>
              ))}
            </div>
          </div>
          <svg width={chartW} height={chartH} style={{ width: "100%", height: "auto" }} viewBox={`0 0 ${chartW} ${chartH}`}>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(v => {
              const y = chartH - chartPad - v * (chartH - chartPad * 2);
              return <g key={v}><line x1={chartPad} y1={y} x2={chartW - chartPad} y2={y} stroke="rgba(255,255,255,0.04)" /><text x={chartPad - 6} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize={9}>{Math.round(v * 100)}%</text></g>;
            })}
            {/* Fill */}
            <path d={retentionFill} fill={retentionTheme ? `${tc(retentionTheme).accent}10` : "rgba(0,229,255,0.06)"} />
            {/* Line */}
            <path d={retentionPath} fill="none" stroke={retentionTheme ? tc(retentionTheme).accent : "#00e5ff"} strokeWidth={2} strokeLinecap="round" />
            {/* Dots */}
            {retentionPoints.filter((_: any, i: number) => i % 5 === 0 || i === retentionPoints.length - 1).map((p: any, i: number) => (
              <circle key={i} cx={p.x} cy={p.y} r={3} fill={retentionTheme ? tc(retentionTheme).accent : "#00e5ff"} />
            ))}
            {/* Date labels */}
            {retentionByDay.filter((_: any, i: number) => i % 7 === 0).map((d: any, i: number) => {
              const x = chartPad + ((i * 7) / (retentionByDay.length - 1)) * (chartW - chartPad * 2);
              return <text key={i} x={x} y={chartH - 10} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize={8}>{d.date.slice(5)}</text>;
            })}
          </svg>
        </div>

        {/* Knowledge Growth */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.5s both" }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 16px" }}>Knowledge Growth — 30 Days</h3>
          <svg width={chartW} height={chartH} style={{ width: "100%", height: "auto" }} viewBox={`0 0 ${chartW} ${chartH}`}>
            {[0, 0.5, 1].map(v => {
              const y = chartH - chartPad - v * (chartH - chartPad * 2);
              return <g key={v}><line x1={chartPad} y1={y} x2={chartW - chartPad} y2={y} stroke="rgba(255,255,255,0.04)" /><text x={chartPad - 6} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize={9}>{Math.round(v * maxClaims)}</text></g>;
            })}
            <path d={claimPath} fill="none" stroke="#7c4dff" strokeWidth={2} strokeLinecap="round" />
            <path d={sourcePath} fill="none" stroke="#00e5ff" strokeWidth={2} strokeLinecap="round" strokeDasharray="6 3" />
            {growthByDay.filter((_: any, i: number) => i % 7 === 0).map((d: any, i: number) => {
              const x = chartPad + ((i * 7) / (growthByDay.length - 1)) * (chartW - chartPad * 2);
              return <text key={i} x={x} y={chartH - 10} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize={8}>{d.date.slice(5)}</text>;
            })}
          </svg>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#7c4dff", marginRight: 6, verticalAlign: "middle" }} />Claims ({overview.totalClaims})</span>
            <span><span style={{ display: "inline-block", width: 12, height: 2, background: "#00e5ff", marginRight: 6, verticalAlign: "middle", borderTop: "2px dashed #00e5ff" }} />Sources ({overview.totalSources})</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* Claim Status */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.6s both" }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 16px" }}>Claim Status</h3>
          {Object.entries(statusCounts).filter(([, v]) => (v as number) > 0).map(([status, count]: any) => (
            <div key={status} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: statusColors[status] || "#666", fontWeight: 500, textTransform: "capitalize" }}>{status}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono'" }}>{count}</span>
              </div>
              <div style={{ height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(count / statusTotal) * 100}%`, height: "100%", background: statusColors[status] || "#666", borderRadius: 3, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))}
        </div>

        {/* Rating Distribution */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.7s both" }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 16px" }}>Rating Distribution</h3>
          {ratingDistribution.total === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, textAlign: "center", padding: 20 }}>No reviews yet</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <svg width={120} height={120} viewBox="0 0 120 120">
                  {ratingValues.map((val: any, i: number) => {
                    const pct = val / ratingTotal;
                    if (pct === 0) return null;
                    const startAngle = ratingAngle;
                    ratingAngle += pct * 360;
                    const endAngle = ratingAngle;
                    const largeArc = pct > 0.5 ? 1 : 0;
                    const startRad = (startAngle - 90) * Math.PI / 180;
                    const endRad = (endAngle - 90) * Math.PI / 180;
                    const x1 = 60 + 45 * Math.cos(startRad), y1 = 60 + 45 * Math.sin(startRad);
                    const x2 = 60 + 45 * Math.cos(endRad), y2 = 60 + 45 * Math.sin(endRad);
                    return <path key={i} d={`M 60 60 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={ratingColors[i]} opacity={0.8} />;
                  })}
                  <circle cx={60} cy={60} r={28} fill="#13304e" />
                  <text x={60} y={56} textAnchor="middle" fill="#e4e4e7" fontSize={16} fontWeight={700} fontFamily="'JetBrains Mono'">{ratingDistribution.total}</text>
                  <text x={60} y={70} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={8}>REVIEWS</text>
                </svg>
              </div>
              {ratingLabels.map((label: any, i: number) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: ratingColors[i], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", flex: 1 }}>{label}</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono'" }}>{ratingValues[i]}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{ratingTotal > 0 ? Math.round(ratingValues[i] / ratingTotal * 100) : 0}%</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Source Types */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.8s both" }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 16px" }}>Content Sources</h3>
          {Object.entries(sourceTypeCounts).map(([type, count]: any) => {
            const typeColors: Record<string, string> = { podcast: "#e040fb", paper: "#00e5ff", article: "#ffd600", book: "#00e676" };
            return (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 24 }}>{SOURCE_ICONS[type] || "📝"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, textTransform: "capitalize" }}>{type}s</div>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.04)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ width: `${(count / overview.totalSources) * 100}%`, height: "100%", background: typeColors[type] || "#666", borderRadius: 2 }} />
                  </div>
                </div>
                <span style={{ fontSize: 20, fontWeight: 700, color: typeColors[type] || "#666", fontFamily: "'JetBrains Mono'" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hardest Claims */}
      {hardClaims.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "24px 28px", animation: "fadeSlideIn 0.4s ease 0.9s both" }}>
          <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", fontWeight: 600, margin: "0 0 4px" }}>Hardest Claims</h3>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 0, marginBottom: 16 }}>Claims with most lapses — these need extra attention</p>
          {hardClaims.map((c: any, i: number) => {
            const themeColor = c.themes[0] ? tc(c.themes[0]).accent : "#666";
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", marginBottom: 6, background: "rgba(255,255,255,0.01)", borderRadius: 8, borderLeft: `3px solid ${themeColor}40` }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.15)", fontFamily: "'JetBrains Mono'", width: 24, textAlign: "center" }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.text}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {c.themes.slice(0, 2).map((t: string) => <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${tc(t).accent}12`, color: tc(t).accent }}>{t}</span>)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center", flexShrink: 0 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#ff4081", fontFamily: "'JetBrains Mono'" }}>{c.lapses}</div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textTransform: "uppercase" }}>lapses</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono'" }}>{c.reps}</div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textTransform: "uppercase" }}>reps</div>
                  </div>
                  <RetentionRing value={c.retention} size={36} color={themeColor} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tables View — Structured Data Comparisons
// ============================================================
interface TableData {
  title: string;
  description: string;
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, string>[];
  footnotes?: string;
  meta?: { claimsSearched: number; sourcesSearched: number; searchTerms: string[]; generatedAt: string };
}

function TablesView({ tc }: any) {
  const [tables, setTables] = useState<TableData[]>([]);
  const [activeTable, setActiveTable] = useState<number>(0);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setProgressMsg("Starting...");

    try {
      const res = await fetch("/api/tables/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Server error" }));
        setError(errData.error || "Server error");
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setError("No response stream"); setLoading(false); return; }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (eventType === "progress") {
                setProgressMsg(payload.step || "Processing...");
              } else if (eventType === "chunk") {
                setProgressMsg(`Generating table... (${payload.length} chars)`);
              } else if (eventType === "done" && payload.success) {
                setTables((prev: TableData[]) => [...prev, payload.data]);
                setActiveTable(tables.length);
                setPrompt("");
                setSortCol(null);
              } else if (eventType === "error") {
                setError(payload.message || "Unknown error");
              }
            } catch { /* skip malformed JSON */ }
            eventType = "";
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgressMsg("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
  };

  const handleSort = (key: string) => {
    if (sortCol === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  const getSortedRows = (table: TableData) => {
    if (!sortCol) return table.rows;
    return [...table.rows].sort((a: Record<string, string>, b: Record<string, string>) => {
      const aVal = (a[sortCol] || "").toString();
      const bVal = (b[sortCol] || "").toString();
      const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ""));
      const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ""));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === "asc" ? aNum - bNum : bNum - aNum;
      }
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  };

  const exportCSV = (table: TableData) => {
    const headers = table.columns.map((c: { key: string; label: string; type: string }) => `"${c.label.replace(/"/g, '""')}"`).join(",");
    const rows = table.rows.map((row: Record<string, string>) =>
      table.columns.map((c: { key: string; label: string; type: string }) => {
        const val = (row[c.key] || "").toString().replace(/"/g, '""');
        return `"${val}"`;
      }).join(",")
    ).join("\n");
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentTable = tables[activeTable] || null;

  const suggestedPrompts = [
    "Compare PME vs synthetic psilocybin across all measured outcomes",
    "Create a table of all papers with their key findings and confidence levels",
    "Compare evidence for and against the entourage effect",
    "List all synaptic protein findings by brain region and treatment",
    "Summarize consumer preferences for natural vs synthetic psychedelics",
  ];

  const getCellStyle = (type: string, value: string) => {
    const base: any = { padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.75)", verticalAlign: "top" };
    if (type === "status") {
      const v = (value || "").toLowerCase();
      const statusColors: Record<string, string> = { supported: "#00e5ff", emerging: "#ffd600", contested: "#ff4081", consensus: "#00e676", contradicted: "#ff1744" };
      if (statusColors[v]) base.color = statusColors[v];
    }
    if (type === "confidence") {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        base.color = num >= 90 ? "#00e676" : num >= 80 ? "#00e5ff" : num >= 70 ? "#ffd600" : "#ff4081";
        base.fontWeight = 600;
        base.fontVariantNumeric = "tabular-nums";
      }
    }
    if (type === "source") {
      base.color = "rgba(0,229,255,0.7)";
      base.fontSize = 12;
    }
    if (value === "—") {
      base.color = "rgba(255,255,255,0.15)";
    }
    return base;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", margin: "-32px -40px", padding: 0 }}>
      {/* Header */}
      <div style={{ padding: "20px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #e4e4e7 30%, rgba(228,228,231,0.5))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Data Tables</h1>
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: "6px 0 0" }}>Generate structured comparisons from your knowledge base</p>
          </div>
          {tables.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => exportCSV(currentTable!)} style={{ padding: "8px 16px", background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 8, color: "#00e5ff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                ↓ Export CSV
              </button>
            </div>
          )}
        </div>

        {/* Table tabs */}
        {tables.length > 1 && (
          <div style={{ display: "flex", gap: 4, marginTop: 16, overflowX: "auto", paddingBottom: 4 }}>
            {tables.map((t: TableData, i: number) => (
              <button key={i} onClick={() => { setActiveTable(i); setSortCol(null); }} style={{
                padding: "6px 14px", borderRadius: 6, border: activeTable === i ? "1px solid rgba(0,229,255,0.2)" : "1px solid rgba(255,255,255,0.06)",
                background: activeTable === i ? "rgba(0,229,255,0.08)" : "rgba(255,255,255,0.02)",
                color: activeTable === i ? "#00e5ff" : "rgba(255,255,255,0.4)",
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
              }}>
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        {/* Empty state */}
        {tables.length === 0 && !loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 24 }}>
            <div style={{ fontSize: 48, opacity: 0.15 }}>▤</div>
            <div style={{ textAlign: "center", maxWidth: 480 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Generate data tables from your research</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>Describe the comparison you want and Nexus will create a structured table from your claims and sources. Export to CSV for further analysis.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 480 }}>
              {suggestedPrompts.map((q: string, i: number) => (
                <button key={i} onClick={() => { setPrompt(q); inputRef.current?.focus(); }} style={{ padding: "10px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, color: "rgba(255,255,255,0.45)", fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.15s" }} onMouseEnter={(e: any) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }} onMouseLeave={(e: any) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: 16 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.3)" }}>{progressMsg || "Searching knowledge base & generating table..."}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>This takes 10–20 seconds</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "12px 16px", background: "rgba(255,23,68,0.08)", border: "1px solid rgba(255,23,68,0.2)", borderRadius: 10, color: "#ff8a80", fontSize: 13, marginBottom: 16 }}>
            Error: {error}
          </div>
        )}

        {/* Table display */}
        {currentTable && !loading && (
          <div style={{ animation: "fadeSlideIn 0.3s ease" }}>
            {/* Title & description */}
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#e4e4e7", margin: "0 0 6px" }}>{currentTable.title}</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0, lineHeight: 1.5 }}>{currentTable.description}</p>
            </div>

            {/* The table */}
            <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: currentTable.columns.length * 160 }}>
                <thead>
                  <tr>
                    {currentTable.columns.map((col: { key: string; label: string; type: string }) => (
                      <th key={col.key} onClick={() => handleSort(col.key)} style={{
                        padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                        color: sortCol === col.key ? "#00e5ff" : "rgba(255,255,255,0.35)",
                        borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", userSelect: "none",
                        background: "rgba(255,255,255,0.02)", whiteSpace: "nowrap", position: "sticky", top: 0,
                      }}>
                        {col.label}
                        {sortCol === col.key && (
                          <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getSortedRows(currentTable).map((row: Record<string, string>, ri: number) => (
                    <tr key={ri} style={{ transition: "background 0.15s" }} onMouseEnter={(e: any) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"} onMouseLeave={(e: any) => e.currentTarget.style.background = "transparent"}>
                      {currentTable.columns.map((col: { key: string; label: string; type: string }) => (
                        <td key={col.key} style={getCellStyle(col.type, row[col.key] || "")}>
                          {row[col.key] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footnotes */}
            {currentTable.footnotes && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10, fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                {currentTable.footnotes}
              </div>
            )}

            {/* Meta */}
            {currentTable.meta && (
              <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                <span>{currentTable.meta.claimsSearched} claims searched</span>
                <span>{currentTable.meta.sourcesSearched} sources searched</span>
                <span>{currentTable.rows.length} rows generated</span>
                <span>{new Date(currentTable.meta.generatedAt).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: "16px 28px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", maxWidth: 800 }}>
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e: any) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the table you want (e.g. 'Compare PME vs synthetic psilocybin across all outcomes')..."
            rows={prompt.includes("\n") ? 2 : 1}
            style={{
              flex: 1, padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12, color: "#e4e4e7", fontSize: 14, fontFamily: "inherit", resize: "none", outline: "none",
              lineHeight: 1.5, transition: "border-color 0.2s",
            }}
            onFocus={(e: any) => e.target.style.borderColor = "rgba(0,229,255,0.3)"}
            onBlur={(e: any) => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
          />
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading}
            style={{
              padding: "12px 20px", borderRadius: 12, border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: prompt.trim() && !loading ? "pointer" : "default",
              background: prompt.trim() && !loading ? "linear-gradient(135deg, #00e5ff, #7c4dff)" : "rgba(255,255,255,0.05)",
              color: prompt.trim() && !loading ? "#000" : "rgba(255,255,255,0.2)",
              transition: "all 0.2s", flexShrink: 0,
            }}
          >
            Generate
          </button>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 8, maxWidth: 800 }}>
          Enter to generate · Tables are built from your claims and sources · Export to CSV for spreadsheets
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Chat View — Research Assistant
// ============================================================
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  context?: { claimsFound: number; sourcesFound: number; claims: any[]; sources: any[] };
  timestamp: Date;
}

function ChatView({ tc }: any) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showContext, setShowContext] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed, timestamp: new Date() };
    setMessages((prev: ChatMessage[]) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((m: ChatMessage) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await res.json();

      if (data.success) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.data.message,
          context: data.data.context,
          timestamp: new Date(),
        };
        setMessages((prev: ChatMessage[]) => [...prev, assistantMsg]);
      } else {
        setMessages((prev: ChatMessage[]) => [...prev, { role: "assistant", content: `Error: ${data.error}`, timestamp: new Date() }]);
      }
    } catch (err: any) {
      setMessages((prev: ChatMessage[]) => [...prev, { role: "assistant", content: `Error: ${err.message}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatMessage = (content: string) => {
    // Format citation references like [CLAIM 1], [SOURCE 2]
    const parts = content.split(/(\[(?:CLAIM|SOURCE)\s+\d+\])/g);
    return parts.map((part: string, i: number) => {
      const claimMatch = part.match(/\[CLAIM\s+(\d+)\]/);
      const sourceMatch = part.match(/\[SOURCE\s+(\d+)\]/);
      if (claimMatch) {
        return <span key={i} style={{ display: "inline-block", padding: "0 5px", borderRadius: 4, background: "rgba(124,77,255,0.15)", color: "#b388ff", fontSize: "0.85em", fontWeight: 600, cursor: "default" }}>{part}</span>;
      }
      if (sourceMatch) {
        return <span key={i} style={{ display: "inline-block", padding: "0 5px", borderRadius: 4, background: "rgba(0,229,255,0.12)", color: "#00e5ff", fontSize: "0.85em", fontWeight: 600, cursor: "default" }}>{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const suggestedQuestions = [
    "What are the key claims across all my sources?",
    "Are there any contradictions in my knowledge base?",
    "Summarize what I know about the most common theme",
    "What are the highest confidence findings?",
    "What gaps exist in my research?",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", margin: "-32px -40px", padding: 0 }}>
      {/* Header */}
      <div style={{ padding: "20px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, fontFamily: "'Outfit', sans-serif", background: "linear-gradient(135deg, #e4e4e7 30%, rgba(228,228,231,0.5))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Research Chat</h1>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: "6px 0 0" }}>Ask questions about your knowledge base — answers are grounded in your sources</p>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 24 }}>
            <div style={{ fontSize: 48, opacity: 0.15 }}>◬</div>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Ask anything about your research</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>Your chat is grounded in {" "} the claims and sources in your knowledge base. Answers include citations so you can trace every statement back to its origin.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 }}>
              {suggestedQuestions.map((q: string, i: number) => (
                <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }} style={{ padding: "10px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, color: "rgba(255,255,255,0.45)", fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.15s" }} onMouseEnter={(e: any) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }} onMouseLeave={(e: any) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg: ChatMessage, i: number) => (
          <div key={i} style={{ marginBottom: 24, animation: "fadeSlideIn 0.3s ease" }}>
            {/* Role label */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0,
                background: msg.role === "user" ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #00e5ff, #7c4dff)",
                color: msg.role === "user" ? "rgba(255,255,255,0.5)" : "#000",
              }}>
                {msg.role === "user" ? "Y" : "N"}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>{msg.role === "user" ? "You" : "Nexus"}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>{msg.timestamp.toLocaleTimeString()}</span>
            </div>

            {/* Message content */}
            <div style={{
              marginLeft: 36, fontSize: 14, lineHeight: 1.7, color: msg.role === "user" ? "rgba(255,255,255,0.7)" : "#e4e4e7",
              ...(msg.role === "user" ? { padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" } : {}),
            }}>
              {msg.role === "user" ? msg.content : formatMessage(msg.content)}
            </div>

            {/* Context panel for assistant messages */}
            {msg.role === "assistant" && msg.context && (msg.context.claimsFound > 0 || msg.context.sourcesFound > 0) && (
              <div style={{ marginLeft: 36, marginTop: 8 }}>
                <button onClick={() => setShowContext(showContext === i ? null : i)} style={{ padding: "4px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 9, transform: showContext === i ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}>▶</span>
                  {msg.context.claimsFound} claims · {msg.context.sourcesFound} sources referenced
                </button>

                {showContext === i && (
                  <div style={{ marginTop: 8, padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, animation: "fadeSlideIn 0.2s ease" }}>
                    {msg.context.claims.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(124,77,255,0.6)", marginBottom: 6 }}>Claims Referenced</div>
                        {msg.context.claims.map((c: any, ci: number) => (
                          <div key={ci} style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 6, paddingLeft: 10, borderLeft: "2px solid rgba(124,77,255,0.2)" }}>
                            <span style={{ color: "#b388ff", fontWeight: 600, marginRight: 4 }}>[{ci + 1}]</span>
                            {c.text}...
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginLeft: 6 }}>{c.status} · {Math.round((c.confidence || 0.5) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.context.sources.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(0,229,255,0.6)", marginBottom: 6 }}>Sources Referenced</div>
                        {msg.context.sources.map((s: any, si: number) => (
                          <div key={si} style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 4, paddingLeft: 10, borderLeft: "2px solid rgba(0,229,255,0.2)" }}>
                            <span style={{ color: "#00e5ff", fontWeight: 600, marginRight: 4 }}>[{si + 1}]</span>
                            {SOURCE_ICONS[(s.type || "").toLowerCase()] || "📝"} {s.title}
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>— {s.author || "Unknown"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ marginBottom: 24, animation: "fadeSlideIn 0.3s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #00e5ff, #7c4dff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#000" }}>N</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>Nexus</span>
            </div>
            <div style={{ marginLeft: 36, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Searching your knowledge base...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "16px 28px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", maxWidth: 800 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e: any) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your research..."
            rows={input.split("\n").length > 3 ? 4 : input.includes("\n") ? 2 : 1}
            style={{
              flex: 1, padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12, color: "#e4e4e7", fontSize: 14, fontFamily: "inherit", resize: "none", outline: "none",
              lineHeight: 1.5, transition: "border-color 0.2s",
            }}
            onFocus={(e: any) => e.target.style.borderColor = "rgba(0,229,255,0.3)"}
            onBlur={(e: any) => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              padding: "12px 20px", borderRadius: 12, border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: input.trim() && !loading ? "pointer" : "default",
              background: input.trim() && !loading ? "linear-gradient(135deg, #00e5ff, #7c4dff)" : "rgba(255,255,255,0.05)",
              color: input.trim() && !loading ? "#000" : "rgba(255,255,255,0.2)",
              transition: "all 0.2s", flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", marginTop: 8, maxWidth: 800 }}>
          Shift+Enter for new line · Responses cite your claims and sources
        </div>
      </div>
    </div>
  );
}
