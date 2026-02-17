// GET /api/review/queue
// Returns review cards due now, with claim context and prompt generation

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fsrs } from "@/services/fsrs";
import type { PromptType, FSRSCard } from "@/types";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const themeId = searchParams.get("themeId");
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: any = {
    userId: MVP_USER_ID,
    due: { lte: new Date() },
  };

  if (themeId) {
    where.claim = {
      themes: { some: { themeId } },
    };
  }

  const cards = await prisma.reviewCard.findMany({
    where,
    include: {
      claim: {
        include: {
          sources: {
            include: {
              source: {
                select: { id: true, title: true, author: true, type: true, summary: true },
              },
            },
          },
          themes: { include: { theme: true } },
          contradicts: {
            include: {
              contradicted: { select: { id: true, text: true, status: true } },
            },
          },
          contradictedBy: {
            include: {
              claim: { select: { id: true, text: true, status: true } },
            },
          },
        },
      },
    },
    orderBy: { due: "asc" },
    take: limit,
  });

  // Build review items with prompts and scheduling previews
  const reviewItems = cards.map((card, index) => {
    const fsrsCard: FSRSCard = {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.lastReview,
    };

    const retrievability = fsrs.getRetrievability(fsrsCard);

    // Rotate prompt type based on reps and index
    const promptTypes: PromptType[] = ["recall", "reflection", "correlation"];
    const promptType = promptTypes[(card.reps + index) % 3];

    // Calculate what happens for each rating
    const options = fsrs.getSchedulingOptions(fsrsCard);

    // Gather contradictions for context
    const contradictions = [
      ...card.claim.contradicts.map((c) => ({
        id: c.contradicted.id,
        text: c.contradicted.text,
        relationship: "contradicts" as const,
      })),
      ...card.claim.contradictedBy.map((c) => ({
        id: c.claim.id,
        text: c.claim.text,
        relationship: "contradicted_by" as const,
      })),
    ];

    return {
      cardId: card.id,
      claimId: card.claim.id,
      claimText: card.claim.text,
      claimStatus: card.claim.status,
      confidence: card.claim.confidence,
      explanation: card.claim.explanation,
      implications: card.claim.implications,
      themes: card.claim.themes.map((t) => ({
        id: t.theme.id,
        name: t.theme.name,
        icon: t.theme.icon,
        color: t.theme.color,
      })),
      sources: card.claim.sources.map((cs) => ({
        id: cs.source.id,
        title: cs.source.title,
        author: cs.source.author,
        type: cs.source.type,
        summary: cs.source.summary,
        supportingQuote: cs.extractedText,
        timestamp: cs.timestamp,
      })),
      contradictions,
      // FSRS data
      retrievability,
      reps: card.reps,
      promptType,
      prompt: generatePrompt(promptType, card.claim.text),
      schedulingPreview: {
        again: { interval: options.again.interval },
        hard: { interval: options.hard.interval },
        good: { interval: options.good.interval },
        easy: { interval: options.easy.interval },
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      items: reviewItems,
      totalDue: await prisma.reviewCard.count({
        where: { userId: MVP_USER_ID, due: { lte: new Date() } },
      }),
    },
  });
}

function generatePrompt(type: PromptType, claimText: string): string {
  switch (type) {
    case "recall":
      return "What does the evidence say about this topic?";
    case "reflection":
      return "Do you still agree with this claim? Has your understanding evolved?";
    case "correlation":
      return "How does this connect to or conflict with related claims you've studied?";
  }
}
