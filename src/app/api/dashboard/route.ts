// GET /api/dashboard
// Returns all aggregate data needed for the dashboard in one call

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fsrs } from "@/services/fsrs";
import type { FSRSCard } from "@/types";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  try {
  // Parallel queries for dashboard data
  const [
    sourceCount,
    claimCount,
    recentSources,
    reviewCards,
    themes,
    recentReviews,
  ] = await Promise.all([
    // Total sources
    prisma.source.count({ where: { userId: MVP_USER_ID, status: "COMPLETE" } }),

    // Total claims
    prisma.claim.count(),

    // Recent sources (last 10)
    prisma.source.findMany({
      where: { userId: MVP_USER_ID, status: "COMPLETE" },
      select: {
        id: true, title: true, author: true, type: true,
        addedAt: true, publicationDate: true,
        themes: { include: { theme: { select: { name: true, icon: true, color: true } } } },
        claims: { select: { claimId: true } },
      },
      orderBy: { addedAt: "desc" },
      take: 10,
    }),

    // All review cards for retention calculations
    prisma.reviewCard.findMany({
      where: { userId: MVP_USER_ID },
      select: {
        id: true, due: true, stability: true, difficulty: true,
        state: true, lastReview: true, reps: true, lapses: true,
        elapsedDays: true, scheduledDays: true,
        claim: {
          select: {
            id: true, status: true, confidence: true,
            themes: { include: { theme: { select: { id: true, name: true } } } },
          },
        },
      },
    }),

    // Themes with counts
    prisma.theme.findMany({
      include: {
        sources: { select: { sourceId: true } },
        claims: {
          include: {
            claim: {
              select: {
                status: true,
                contradicts: { select: { id: true } },
                contradictedBy: { select: { id: true } },
              },
            },
          },
        },
      },
    }),

    // Review activity (last 7 days)
    prisma.reviewLog.findMany({
      where: {
        userId: MVP_USER_ID,
        reviewedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { rating: true, reviewedAt: true, scheduledDays: true },
      orderBy: { reviewedAt: "desc" },
    }),
  ]);

  // Calculate overall retention
  const activeCards = reviewCards.filter((c) => c.lastReview !== null);
  const overallRetention =
    activeCards.length > 0
      ? activeCards.reduce((sum, card) => {
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
          return sum + fsrs.getRetrievability(fsrsCard);
        }, 0) / activeCards.length
      : 0;

  // Cards due now
  const dueNow = reviewCards.filter((c) => new Date(c.due) <= new Date()).length;

  // Claim status breakdown
  const statusCounts = {
    consensus: 0,
    supported: 0,
    emerging: 0,
    contested: 0,
    contradicted: 0,
  };
  reviewCards.forEach((card) => {
    const s = card.claim.status.toLowerCase() as keyof typeof statusCounts;
    if (s in statusCounts) statusCounts[s]++;
  });

  // Theme stats
  const themeStats = themes
    .map((theme) => {
      const themeCards = reviewCards.filter((c) =>
        c.claim.themes.some((t) => t.theme.id === theme.id)
      );
      const active = themeCards.filter((c) => c.lastReview !== null);
      const retention =
        active.length > 0
          ? active.reduce((sum, card) => {
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
              return sum + fsrs.getRetrievability(fsrsCard);
            }, 0) / active.length
          : 0;

      const due = themeCards.filter((c) => new Date(c.due) <= new Date()).length;
      const contradictions = theme.claims.reduce((count, ct) => {
        return count + ct.claim.contradicts.length + ct.claim.contradictedBy.length;
      }, 0);

      return {
        id: theme.id,
        name: theme.name,
        icon: theme.icon || "📂",
        color: theme.color || "#00e5ff",
        bgColor: theme.bgColor || "#0a0f1a",
        sourceCount: theme.sources.length,
        claimCount: theme.claims.length,
        avgRetention: retention,
        dueForReview: due,
        contradictionCount: Math.floor(contradictions / 2),
      };
    })
    .filter((t) => t.sourceCount > 0 || t.claimCount > 0)
    .sort((a, b) => b.claimCount - a.claimCount);

  // Weekly review activity
  const reviewsByDay: Record<string, number> = {};
  recentReviews.forEach((r) => {
    const day = new Date(r.reviewedAt).toISOString().split("T")[0];
    reviewsByDay[day] = (reviewsByDay[day] || 0) + 1;
  });

  return NextResponse.json({
    success: true,
    data: {
      overview: {
        sourceCount,
        claimCount,
        overallRetention,
        dueForReview: dueNow,
        statusCounts,
        reviewsThisWeek: recentReviews.length,
      },
      themes: themeStats,
      recentSources: recentSources.map((s) => ({
        id: s.id,
        title: s.title,
        author: s.author,
        type: s.type,
        addedAt: s.addedAt,
        publicationDate: s.publicationDate,
        themes: s.themes.map((t) => ({
          name: t.theme.name,
          icon: t.theme.icon,
          color: t.theme.color,
        })),
        claimCount: s.claims.length,
      })),
      reviewActivity: reviewsByDay,
    },
  });
  } catch (err: any) {
    console.error("Dashboard API error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
