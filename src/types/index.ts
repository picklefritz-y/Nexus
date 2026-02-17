// ============================================================
// Nexus Knowledge Engine — Core Types
// ============================================================

import { z } from "zod";

// --- Source Types ---

export const SourceTypeEnum = z.enum(["PODCAST", "PAPER", "ARTICLE", "BOOK"]);
export type SourceType = z.infer<typeof SourceTypeEnum>;

export const ProcessingStatusEnum = z.enum([
  "PENDING", "FETCHING", "EXTRACTING", "PROCESSING", "LINKING", "COMPLETE", "FAILED",
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatusEnum>;

// --- Ingestion Input ---

export const IngestRequestSchema = z.object({
  url: z.string().url().optional(),
  doi: z.string().optional(),
  type: SourceTypeEnum.optional(), // auto-detected if not provided
  userNotes: z.string().optional(),
}).refine((data) => data.url || data.doi, {
  message: "Either URL or DOI must be provided",
});

export type IngestRequest = z.infer<typeof IngestRequestSchema>;

// --- AI Pipeline Types ---

export interface ExtractedContent {
  title: string;
  author: string;
  text: string;
  publicationDate?: string;
  metadata: {
    type: SourceType;
    journal?: string;
    abstract?: string;
    podcastName?: string;
    episodeNumber?: string;
    durationSeconds?: number;
  };
}

export interface ExtractedClaim {
  text: string;
  explanation: string;
  implications: string;
  methodology?: string;
  confidence: number;          // 0-1
  supportingQuote: string;     // exact passage from source
  timestamp?: string;          // for podcasts
  pageNumber?: number;         // for papers
}

export interface ThemeSuggestion {
  name: string;
  relevance: number;           // 0-1
  isNew: boolean;              // theme doesn't exist yet
}

export interface ContradictionDetection {
  newClaimText: string;
  existingClaimId: string;
  existingClaimText: string;
  explanation: string;
  severity: number;            // 0-1
  type: "direct_contradiction" | "nuance" | "supersession" | "scope_limitation";
}

export interface ProcessingResult {
  source: {
    title: string;
    author: string;
    summary: string;
    keyTakeaways: string[];
    publicationDate?: string;
  };
  claims: ExtractedClaim[];
  themes: ThemeSuggestion[];
  contradictions: ContradictionDetection[];
}

// --- FSRS Types ---

export interface FSRSCard {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: FSRSState;
  lastReview: Date | null;
}

export enum FSRSState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export enum FSRSRating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

// --- Review Prompt Types ---

export type PromptType = "recall" | "reflection" | "correlation";

export interface ReviewPrompt {
  type: PromptType;
  question: string;
  claimId: string;
  claimText: string;
  themes: string[];
  relatedClaims?: {
    id: string;
    text: string;
    relationship: "supports" | "contradicts" | "related";
  }[];
}

// --- Dashboard Types ---

export interface ThemeStats {
  id: string;
  name: string;
  icon: string;
  color: string;
  sourceCount: number;
  claimCount: number;
  avgRetention: number;
  contradictionCount: number;
  dueForReview: number;
}

export interface WeeklyDigest {
  weekStart: Date;
  weekEnd: Date;
  sourcesAdded: number;
  claimsExtracted: number;
  reviewsCompleted: number;
  avgRetention: number;
  summary: string;
  keyInsights: string[];
  newContradictions: ContradictionDetection[];
  recommendations: string[];
}

// --- API Response Types ---

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// --- Semantic Scholar Types ---

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  authors: { authorId: string; name: string }[];
  citationCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  journal?: { name: string; volume?: string; pages?: string };
  openAccessPdf?: { url: string };
  tldr?: { text: string };
  url: string;
}
