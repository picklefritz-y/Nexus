// ============================================================
// Content Fetching Services
// Handles retrieving and extracting text from different source types
// ============================================================

import { ExtractedContent, SemanticScholarPaper } from "@/types";

// ============================================================
// 1. Podcast Transcript Service (AssemblyAI)
// ============================================================

export class TranscriptService {
  private apiKey: string;
  private baseUrl = "https://api.assemblyai.com/v2";

  constructor() {
    this.apiKey = process.env.ASSEMBLYAI_API_KEY!;
  }

  /**
   * Submit a podcast URL for transcription and return the transcript
   * AssemblyAI handles: speaker diarization, auto chapters, topic detection
   */
  async transcribe(audioUrl: string): Promise<{
    text: string;
    chapters: { headline: string; summary: string; start: number; end: number }[];
    speakers: { speaker: string; text: string; start: number; end: number }[];
    topics: { text: string; relevance: number }[];
    durationSeconds: number;
  }> {
    // Step 1: Submit transcription job
    const submitResponse = await fetch(`${this.baseUrl}/transcript`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        auto_chapters: true,         // AI-generated chapters with summaries
        speaker_labels: true,        // Identify different speakers
        iab_categories: true,        // Topic detection
        summarization: true,
        summary_model: "informative",
        summary_type: "bullets",
      }),
    });

    if (!submitResponse.ok) {
      throw new Error(`AssemblyAI submit failed: ${submitResponse.statusText}`);
    }

    const { id } = await submitResponse.json();

    // Step 2: Poll for completion
    const transcript = await this.pollForCompletion(id);

    return {
      text: transcript.text,
      chapters: (transcript.chapters || []).map((ch: any) => ({
        headline: ch.headline,
        summary: ch.summary,
        start: ch.start,
        end: ch.end,
      })),
      speakers: (transcript.utterances || []).map((u: any) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
      })),
      topics: Object.entries(transcript.iab_categories_result?.summary || {}).map(
        ([text, relevance]: [string, any]) => ({ text, relevance })
      ),
      durationSeconds: Math.round((transcript.audio_duration || 0)),
    };
  }

  private async pollForCompletion(transcriptId: string, maxAttempts = 120): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.baseUrl}/transcript/${transcriptId}`, {
        headers: { Authorization: this.apiKey },
      });

      const data = await response.json();

      if (data.status === "completed") return data;
      if (data.status === "error") throw new Error(`Transcription failed: ${data.error}`);

      // Wait 5 seconds before polling again
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error("Transcription timed out");
  }
}

// ============================================================
// 2. Paper Service (Semantic Scholar + PDF extraction)
// ============================================================

export class PaperService {
  private s2BaseUrl = "https://api.semanticscholar.org/graph/v1";
  private s2ApiKey?: string;

  constructor() {
    this.s2ApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  /**
   * Fetch paper metadata from Semantic Scholar by DOI or URL
   */
  async fetchMetadata(identifier: string): Promise<SemanticScholarPaper | null> {
    // Normalize identifier — could be DOI, S2 ID, arXiv ID, or URL
    const paperId = this.normalizeIdentifier(identifier);

    const fields = [
      "title", "abstract", "year", "authors", "citationCount",
      "influentialCitationCount", "fieldsOfStudy", "journal",
      "openAccessPdf", "tldr", "url",
    ].join(",");

    const response = await fetch(
      `${this.s2BaseUrl}/paper/${paperId}?fields=${fields}`,
      {
        headers: this.s2ApiKey
          ? { "x-api-key": this.s2ApiKey }
          : {},
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Semantic Scholar API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Search for papers by keyword
   */
  async searchPapers(query: string, limit = 10): Promise<SemanticScholarPaper[]> {
    const fields = "title,abstract,year,authors,citationCount,openAccessPdf,tldr,url";

    const response = await fetch(
      `${this.s2BaseUrl}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
      {
        headers: this.s2ApiKey
          ? { "x-api-key": this.s2ApiKey }
          : {},
      }
    );

    if (!response.ok) throw new Error(`S2 search failed: ${response.statusText}`);

    const data = await response.json();
    return data.data || [];
  }

  /**
   * Get papers that cite a given paper (for building knowledge graphs)
   */
  async getCitations(paperId: string, limit = 20): Promise<SemanticScholarPaper[]> {
    const fields = "title,abstract,year,authors,citationCount,url";

    const response = await fetch(
      `${this.s2BaseUrl}/paper/${paperId}/citations?fields=${fields}&limit=${limit}`,
      {
        headers: this.s2ApiKey ? { "x-api-key": this.s2ApiKey } : {},
      }
    );

    if (!response.ok) throw new Error(`S2 citations failed: ${response.statusText}`);

    const data = await response.json();
    return (data.data || []).map((d: any) => d.citingPaper);
  }

  /**
   * Extract text from a PDF file buffer
   * Uses pdf-parse for native PDFs, falls back to OCR considerations
   */
  async extractPdfText(pdfBuffer: Buffer): Promise<string> {
    // Dynamic import for pdf-parse (CommonJS module)
    // @ts-ignore
    const pdfParse = (await import("pdf-parse")).default;

    const data = await pdfParse(pdfBuffer);
    return data.text;
  }

  /**
   * Full paper processing: metadata + PDF text extraction
   */
  async processsPaper(identifier: string): Promise<ExtractedContent | null> {
    // 1. Get metadata from Semantic Scholar
    const metadata = await this.fetchMetadata(identifier);
    if (!metadata) return null;

    let fullText = metadata.abstract || "";

    // 2. If open access PDF available, extract full text
    if (metadata.openAccessPdf?.url) {
      try {
        const pdfResponse = await fetch(metadata.openAccessPdf.url);
        if (pdfResponse.ok) {
          const buffer = Buffer.from(await pdfResponse.arrayBuffer());
          fullText = await this.extractPdfText(buffer);
        }
      } catch (error) {
        console.warn("PDF extraction failed, falling back to abstract:", error);
      }
    }

    return {
      title: metadata.title,
      author: metadata.authors.map((a) => a.name).join(", "),
      text: fullText,
      publicationDate: metadata.year ? `${metadata.year}-01-01` : undefined,
      metadata: {
        type: "PAPER",
        journal: metadata.journal?.name,
        abstract: metadata.abstract || undefined,
      },
    };
  }

  private normalizeIdentifier(input: string): string {
    // Handle DOI
    if (input.startsWith("10.") || input.includes("doi.org/")) {
      const doi = input.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
      return `DOI:${doi}`;
    }
    // Handle arXiv
    if (input.includes("arxiv.org")) {
      const match = input.match(/(\d{4}\.\d{4,5})/);
      if (match) return `ARXIV:${match[1]}`;
    }
    // Handle Semantic Scholar URL
    if (input.includes("semanticscholar.org/paper/")) {
      const match = input.match(/\/paper\/[^/]*?\/([a-f0-9]+)/i);
      if (match) return match[1];
    }
    // Handle PubMed
    if (input.includes("pubmed.ncbi.nlm.nih.gov")) {
      const match = input.match(/\/(\d+)/);
      if (match) return `PMID:${match[1]}`;
    }
    // Assume it's already a valid ID
    return input;
  }
}

// ============================================================
// 3. Article Extraction Service (Web / Twitter/X)
// ============================================================

export class ArticleService {
  /**
   * Extract article content from a web URL
   * Uses server-side fetch + cheerio for parsing
   */
  async extractArticle(url: string): Promise<ExtractedContent> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "NexusKnowledgeEngine/1.0 (Research Tool)",
      },
    });

    if (!response.ok) throw new Error(`Failed to fetch article: ${response.statusText}`);

    const html = await response.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footers
    $("script, style, nav, footer, header, aside, .ad, .advertisement").remove();

    // Try to find the main article content
    const selectors = [
      "article", "[role='main']", ".post-content", ".article-body",
      ".entry-content", ".story-body", "main", ".content",
    ];

    let articleText = "";
    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0 && el.text().trim().length > 200) {
        articleText = el.text().trim();
        break;
      }
    }

    // Fallback to body text
    if (!articleText) {
      articleText = $("body").text().trim();
    }

    // Clean up whitespace
    articleText = articleText.replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    // Extract metadata
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      $("h1").first().text() ||
      "Untitled Article";

    const author =
      $('meta[name="author"]').attr("content") ||
      $('meta[property="article:author"]').attr("content") ||
      $('[rel="author"]').first().text() ||
      "Unknown Author";

    const publishDate =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[name="date"]').attr("content") ||
      $("time").first().attr("datetime");

    // Determine if this is a Twitter/X post
    const isTwitter = url.includes("twitter.com") || url.includes("x.com");

    return {
      title: title.trim(),
      author: author.trim(),
      text: articleText,
      publicationDate: publishDate,
      metadata: {
        type: "ARTICLE",
      },
    };
  }

  /**
   * Extract content from a Twitter/X thread
   * Note: X API access is limited; this uses the Nitter approach or user-supplied text
   */
  async extractTweet(url: string): Promise<ExtractedContent> {
    // Twitter/X doesn't allow easy scraping
    // For MVP: user can paste the thread text manually
    // For production: use X API v2 with bearer token
    // Alternative: use a service like Thread Reader or Nitter

    // Attempt basic extraction
    return this.extractArticle(url);
  }
}

// ============================================================
// Source Type Detection
// ============================================================

export function detectSourceType(url: string): "PODCAST" | "PAPER" | "ARTICLE" {
  const lowerUrl = url.toLowerCase();

  // Podcast indicators
  if (
    lowerUrl.includes("spotify.com/episode") ||
    lowerUrl.includes("podcasts.apple.com") ||
    lowerUrl.includes("youtube.com/watch") ||
    lowerUrl.includes("overcast.fm") ||
    lowerUrl.includes("pocketcasts.com") ||
    lowerUrl.includes(".mp3") ||
    lowerUrl.includes("podcast")
  ) {
    return "PODCAST";
  }

  // Paper indicators
  if (
    lowerUrl.includes("doi.org") ||
    lowerUrl.includes("arxiv.org") ||
    lowerUrl.includes("pubmed") ||
    lowerUrl.includes("ncbi.nlm.nih.gov") ||
    lowerUrl.includes("semanticscholar.org") ||
    lowerUrl.includes("biorxiv.org") ||
    lowerUrl.includes("medrxiv.org") ||
    lowerUrl.includes("nature.com/articles") ||
    lowerUrl.includes("sciencedirect.com") ||
    lowerUrl.includes(".pdf")
  ) {
    return "PAPER";
  }

  // Everything else is an article
  return "ARTICLE";
}

// Singleton instances
export const transcriptService = new TranscriptService();
export const paperService = new PaperService();
export const articleService = new ArticleService();
