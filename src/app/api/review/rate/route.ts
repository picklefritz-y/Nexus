// POST /api/review/rate
// Submit a review rating and update the FSRS card state

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fsrs } from "@/services/fsrs";
import { FSRSRating, FSRSCard } from "@/types";

const MVP_USER_ID = "user_mvp";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { cardId, rating, promptType, responseTimeMs } = body;

  if (!cardId || !rating || ![1, 2, 3, 4].includes(rating)) {
    return NextResponse.json(
      { success: false, error: "cardId and rating (1-4) are required" },
      { status: 400 }
    );
  }

  // Get current card state
  const card = await prisma.reviewCard.findUnique({
    where: { id: cardId },
  });

  if (!card || card.userId !== MVP_USER_ID) {
    return NextResponse.json(
      { success: false, error: "Card not found" },
      { status: 404 }
    );
  }

  // Build FSRS card from DB record
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

  // Schedule the card with the given rating
  const newCard = fsrs.schedule(fsrsCard, rating as FSRSRating);

  // Update the card in the database
  await prisma.reviewCard.update({
    where: { id: cardId },
    data: {
      due: newCard.due,
      stability: newCard.stability,
      difficulty: newCard.difficulty,
      elapsedDays: newCard.elapsedDays,
      scheduledDays: newCard.scheduledDays,
      reps: newCard.reps,
      lapses: newCard.lapses,
      state: newCard.state,
      lastReview: newCard.lastReview,
    },
  });

  // Log the review for analytics
  await prisma.reviewLog.create({
    data: {
      userId: MVP_USER_ID,
      cardId,
      rating,
      prevStability: fsrsCard.stability,
      prevDifficulty: fsrsCard.difficulty,
      prevState: fsrsCard.state,
      newStability: newCard.stability,
      newDifficulty: newCard.difficulty,
      newState: newCard.state,
      scheduledDays: newCard.scheduledDays,
      promptType,
      responseTimeMs,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      cardId,
      rating,
      previousDue: card.due,
      newDue: newCard.due,
      stability: newCard.stability,
      difficulty: newCard.difficulty,
      scheduledDays: newCard.scheduledDays,
      reps: newCard.reps,
      lapses: newCard.lapses,
      state: newCard.state,
    },
  });
}
