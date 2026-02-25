# NEXUS — Personal Knowledge Management System

## What This Is

Nexus is a full-stack knowledge management system for organizing psychedelic research (primarily psilocybin studies). It ingests papers and podcasts, extracts discrete falsifiable claims via Claude AI, tracks contradictions between claims, organizes everything by theme, and provides spaced repetition review (FSRS algorithm) for retention.

The system is built for a researcher at AJNA BioSciences who is comparing natural vs synthetic psilocybin compounds.

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL via Prisma ORM (hosted on Neon free tier)
- **AI**: Claude API (claude-sonnet-4-20250514) via @anthropic-ai/sdk
- **Transcription**: AssemblyAI (for podcast ingestion)
- **Deployment**: Vercel (Hobby plan — 10s function timeout)
- **Styling**: All inline styles in a single React component (no CSS files, no Tailwind)

## Project Structure


src/
├── app/
│   ├── api/
│   │   ├── analytics/route.ts      # Review heatmap + stats
│   │   ├── chat/route.ts           # Streaming RAG chat endpoint
│   │   ├── claims/route.ts         # List claims
│   │   ├── claims/[id]/route.ts    # Single claim CRUD
│   │   ├── content/route.ts        # List sources
│   │   ├── content/[id]/route.ts   # Single source detail (claims, transcript, etc.)
│   │   ├── content/ingest/route.ts # Web-based ingestion (limited by Vercel timeout)
│   │   ├── dashboard/route.ts      # Theme stats, retention, due cards
│   │   ├── search/route.ts         # Global search across claims/sources/themes
│   │   ├── tables/generate/route.ts # AI table generation (streaming SSE)
│   │   ├── themes/route.ts         # List themes
│   │   ├── themes/[id]/route.ts    # Single theme
│   │   └── review/
│   │       ├── queue/route.ts      # Get due review cards
│   │       └── rate/route.ts       # Submit review rating
│   ├── components/
│   │   └── NexusApp.tsx            # THE main file (~2500 lines, entire UI)
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── prisma.ts                   # Prisma client singleton
│   └── hooks.ts                    # React hooks
├── services/
│   ├── ai-pipeline.ts              # Claude claim extraction logic
│   ├── content-fetcher.ts          # URL/DOI content fetching
│   ├── content-pipeline.ts         # Full ingestion orchestration
│   └── fsrs.ts                     # FSRS spaced repetition algorithm
└── types/
    └── index.ts                    # TypeScript interfaces

scripts/
├── ingest-paper.ts                 # CLI: npx tsx scripts/ingest-paper.ts "DOI_URL"
└── ingest-podcast.ts               # CLI: npx tsx scripts/ingest-podcast.ts "YOUTUBE_URL"

prisma/
├── schema.prisma                   # 13 models, full schema
└── seed.ts                         # Demo data seeder
```

## Key Architecture Decisions

### Single-File Frontend
`NexusApp.tsx` contains ALL views, components, and logic (~2500 lines). This was intentional for rapid iteration. Views include: Dashboard, Library, Claims, Chat, Tables, Graph, Analytics, Ingest, Review. All styling is inline — no external CSS.

### Streaming APIs
Two endpoints use Server-Sent Events (SSE) to beat Vercel's 10s Hobby timeout:
- `/api/chat/route.ts` — streams Claude responses
- `/api/tables/generate/route.ts` — streams progress + final table JSON

Pattern: Send `event: progress` and `event: chunk` keepalives, then `event: done` with the final payload. Frontend reads with `ReadableStream` reader.

### Ingestion Pipeline
Papers and podcasts are ingested via CLI scripts (not the web UI) because they take 20-30s and exceed Vercel's timeout. The pipeline:
1. Fetch content (Semantic Scholar API for papers, yt-dlp + AssemblyAI for podcasts)
2. Extract claims via Claude (5-15 discrete falsifiable claims per source)
3. Detect themes (maps to existing themes or creates new ones)
4. Detect contradictions (compares new claims against all existing claims)
5. Store everything with FSRS review cards

### Database
Neon PostgreSQL free tier. Connection string in `.env` as `DATABASE_URL`. The current user is `user_mvp` (hardcoded — no auth system yet). Key models: Source, Claim, Theme, ClaimSource, Contradiction, ReviewCard.

### Visual Design
Dark theme with a realistic animated neural network canvas background (neurons with curved dendrites, orange electrical pulse signals, chain reactions). Teal-blue palette (`#0c2240` base). Glassmorphism on sidebar and cards. Font: Outfit for headers, DM Sans for body, JetBrains Mono for code.

## Environment Variables

```
DATABASE_URL=postgresql://neondb_owner:PASSWORD@ep-lingering-shape-afohcoye-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...
ASSEMBLYAI_API_KEY=...  (only needed for podcast ingestion)
```

## Common Commands

```bash
# Development
npm run dev                          # Start local dev server (localhost:3000)
npm run build                        # Production build (catches TypeScript errors)

# Ingestion (run from project root)
npx tsx scripts/ingest-paper.ts "https://doi.org/10.xxxx/xxxxx"
npx tsx scripts/ingest-podcast.ts "https://youtube.com/watch?v=xxxxx"

# Database
npx prisma studio                    # Visual DB browser
npx prisma db push                   # Push schema changes to Neon
npx prisma generate                  # Regenerate Prisma client

# Deploy
git add -A && git commit -m "message" && git push   # Triggers Vercel auto-deploy
```

## Current State (Feb 2026)

- 7+ psilocybin research papers ingested with 40+ claims
- Themes: Entourage Effects, Neuroplasticity, Metabolomics, Consumer Attitudes, Environmental Impact
- Chat working with RAG (searches claims + sources, cites evidence)
- Tables working with streaming (generates structured comparisons from knowledge base)
- Library detail panel shows claims, key takeaways, supporting quotes, and full transcript/text per source
- Visual: animated neural network background with synapse firing
- Deployed at: https://nexus-self-kappa.vercel.app
- GitHub: https://github.com/picklefritz-y/Nexus

## Known Limitations

- **Vercel Hobby timeout**: Web-based ingestion fails (10s limit). Use CLI scripts instead.
- **No auth**: Single user (`user_mvp`). No login system.
- **publicationDate**: Prisma returns Date objects, not strings. Use `new Date(x).toISOString().split("T")[0]` not `.split("T")` directly.
- **Error handling**: API routes have try/catch but frontend error display is minimal.
- **All inline styles**: No CSS extraction — editing styles means editing TSX.

## Coding Patterns

### API Error Handling
```typescript
export async function GET(request: NextRequest) {
  try {
    // ... logic
  } catch (err: any) {
    console.error("API error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
```

### Frontend Fetch Pattern
```typescript
const data = res.ok ? await res.json() : { success: false, error: "Server error" };
```

### SSE Streaming Pattern (API side)
```typescript
function sendEvent(controller: ReadableStreamDefaultController, event: string, data: any) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}
// Send keepalives during long operations, then sendEvent(controller, "done", result)
```

### SSE Streaming Pattern (Frontend side)
```typescript
const reader = res.body?.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // Parse SSE events from buffer
}
```

## When Making Changes

- After editing `NexusApp.tsx`, run `npm run build` to catch TypeScript errors before pushing
- Vercel auto-deploys on push to `main`
- Test locally with `npm run dev` first — the Neon DB is shared between local and production
- The `.env` file has the Neon connection string — never commit it (it's in `.gitignore`)
- Use `catch (_e)` not bare `catch {}` for TypeScript compatibility in production builds
