# 🔮 Nexus

**Personal knowledge engine that turns podcasts, papers, and articles into a searchable, interconnected knowledge graph with spaced repetition.**

Nexus ingests content from multiple sources, uses AI to extract discrete claims, detects themes and contradictions across your knowledge base, and helps you retain what you learn through FSRS-powered spaced repetition reviews.

---

## What It Does

- **Ingest anything** — Paste a YouTube URL, DOI, arXiv link, PubMed ID, or web article URL. Nexus fetches, transcribes, and processes it automatically.
- **AI claim extraction** — Claude identifies discrete, falsifiable claims from your content with confidence scores and supporting evidence.
- **Theme detection** — Automatically groups claims into knowledge domains, matching existing themes or creating new ones.
- **Contradiction tracking** — Finds when new claims conflict with things you already know, surfacing active debates in your knowledge base.
- **Spaced repetition** — Every claim becomes a review card using the FSRS algorithm. Three prompt types (recall, reflection, correlation) keep reviews varied.
- **Knowledge graph** — Interactive force-directed visualization showing how themes, claims, and sources interconnect.
- **Global search** — Cmd+K to search across all claims, sources, and themes instantly.
- **Analytics** — Review heatmaps, retention curves, knowledge growth tracking, and identification of your hardest claims.

---

## Quick Start (Docker)

The fastest way to run Nexus. Requires [Docker](https://docs.docker.com/get-docker/) and an [Anthropic API key](https://console.anthropic.com).

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/nexus.git
cd nexus

# Configure
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Launch
docker compose up -d

# Open http://localhost:3000
```

That's it. The database, migrations, and app all start automatically.

To stop: `docker compose down`
To reset the database: `docker compose down -v` (deletes all data)

---

## Manual Setup (Development)

If you prefer running without Docker or want to develop locally.

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- [Anthropic API key](https://console.anthropic.com)

### Steps

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/nexus.git
cd nexus
npm install

# Configure
cp .env.example .env
# Edit .env — set your ANTHROPIC_API_KEY and DATABASE_URL

# Set up database
npx prisma db push
npx prisma db seed    # optional: adds sample themes

# Start
npm run dev

# Open http://localhost:3000
```

### Optional: Podcast Support

Podcast ingestion requires yt-dlp and ffmpeg for audio extraction, plus an [AssemblyAI API key](https://www.assemblyai.com) for transcription.

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
pip install yt-dlp
```

Add your ASSEMBLYAI_API_KEY to .env.

---

## Ingesting Content

### From the Web UI

Click **Add Content** in the sidebar and paste any URL:
- Article URLs → scraped and processed automatically
- DOI / arXiv / PubMed links → fetches paper metadata from Semantic Scholar, extracts PDF text if open access
- Progress shown in real-time as the pipeline runs

### From the Terminal

```bash
# Podcasts (requires AssemblyAI key + yt-dlp + ffmpeg)
npx tsx scripts/ingest-podcast.ts "https://www.youtube.com/watch?v=..."

# Papers & Articles
npx tsx scripts/ingest-paper.ts "10.1038/s41586-024-07386-0"
npx tsx scripts/ingest-paper.ts "https://arxiv.org/abs/2401.12345"
npx tsx scripts/ingest-paper.ts "https://pubmed.ncbi.nlm.nih.gov/31729089/"
npx tsx scripts/ingest-paper.ts "https://example.com/some-article"
```

---

## Architecture

```
nexus/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   └── NexusApp.tsx        # Full UI (dashboard, graph, analytics, review)
│   │   └── api/
│   │       ├── dashboard/           # Aggregated dashboard data
│   │       ├── content/             # Source CRUD + ingestion
│   │       ├── claims/              # Claims with relationships
│   │       ├── review/              # FSRS review queue + rating
│   │       ├── search/              # Global search
│   │       ├── analytics/           # Learning analytics
│   │       └── themes/              # Theme management
│   ├── services/
│   │   ├── ai-pipeline.ts          # Claude: extraction, themes, contradictions
│   │   ├── content-fetcher.ts      # Transcription, papers, article scraping
│   │   ├── content-pipeline.ts     # Orchestrates the full ingestion flow
│   │   └── fsrs.ts                 # FSRS spaced repetition algorithm
│   └── types/
│       └── index.ts                # Shared TypeScript types + Zod schemas
├── prisma/
│   └── schema.prisma               # Database schema (13 models)
├── scripts/
│   ├── ingest-podcast.ts           # Terminal podcast ingestion
│   └── ingest-paper.ts             # Terminal paper/article ingestion
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, HTML5 Canvas (graph), SVG (charts) |
| Framework | Next.js 15 (App Router) |
| Database | PostgreSQL + Prisma ORM |
| AI | Claude (Anthropic API) |
| Transcription | AssemblyAI |
| Papers | Semantic Scholar API |
| Spaced Repetition | FSRS algorithm |

### Database Models

- **Source** — podcast, paper, article, or book with metadata and raw text
- **Claim** — discrete factual assertion with confidence, explanation, status
- **Theme** — knowledge domain that groups related claims and sources
- **ReviewCard** — FSRS card state per claim (stability, difficulty, due date)
- **Contradiction** — explicit link between conflicting claims with severity
- **ReviewLog** — full history of every review rating for analytics

---

## API Keys

| Key | Required | Free Tier | Used For |
|-----|----------|-----------|----------|
| ANTHROPIC_API_KEY | Yes | No ($5 credit on signup) | Claim extraction, theme detection, contradictions |
| ASSEMBLYAI_API_KEY | For podcasts | Yes (100hrs) | Audio transcription |
| SEMANTIC_SCHOLAR_API_KEY | No | Yes | Better rate limits for paper lookups |

### Cost Estimate

Each source ingestion makes 3 Claude API calls (~$0.01-0.05 per source depending on length). A typical month of 30 sources would cost roughly $0.50-1.50 in API usage.

---

## Configuration

All configuration is through environment variables in .env. See .env.example for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| ANTHROPIC_API_KEY | — | Required. Your Claude API key |
| DATABASE_URL | — | PostgreSQL connection string |
| ASSEMBLYAI_API_KEY | — | Optional. For podcast transcription |
| SEMANTIC_SCHOLAR_API_KEY | — | Optional. For paper lookups |
| DB_PASSWORD | nexus_default_pw | Docker Compose DB password |
| APP_PORT | 3000 | Port the app runs on |

---

## Contributing

Contributions are welcome! Some areas that could use help:

- [ ] Full-text search with PostgreSQL tsvector or embedding-based search
- [ ] Embedding-based claim deduplication and similarity
- [ ] Mobile-responsive UI
- [ ] Import/export functionality (JSON, Markdown)
- [ ] Browser extension for one-click article ingestion
- [ ] WebSocket-based real-time ingestion progress
- [ ] Multi-user support with proper authentication

---

## License

MIT — use it however you want.
