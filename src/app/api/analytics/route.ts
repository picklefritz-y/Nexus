// GET /api/analytics
// Returns all analytics data: review history, retention trends, claim growth, hard claims

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fsrs } from "@/services/fsrs";
import type { FSRSCard } from "@/types";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  const [
    reviewLogs,
    allCards,
    allClaims,
    allSources,
    allThemes,
  ] = await Promise.all([
    // All review logs (last 90 days)
    prisma.reviewLog.findMany({
      where: { userId: MVP_USER_ID, reviewedAt: { gte: ninetyDaysAgo } },
      select: {
        rating: true,
        reviewedAt: true,
        scheduledDays: true,
        prevStability: true,
        newStability: true,
        prevState: true,
        newState: true,
        responseTimeMs: true,
        card: {
          select: {
            claim: {
              select: {
                id: true,
                text: true,
                themes: { include: { theme: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { reviewedAt: "asc" },
    }),

    // All review cards
    prisma.reviewCard.findMany({
      where: { userId: MVP_USER_ID },
      select: {
        id: true, due: true, stability: true, difficulty: true,
        reps: true, lapses: true, state: true, lastReview: true,
        elapsedDays: true, scheduledDays: true,
        claim: {
          select: {
            id: true, text: true, status: true, confidence: true, createdAt: true,
            themes: { include: { theme: { select: { name: true } } } },
          },
        },
      },
    }),

    // Claim count with creation dates
    prisma.claim.findMany({
      select: { id: true, status: true, confidence: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),

    // Source count with dates
    prisma.source.findMany({
      where: { userId: MVP_USER_ID, status: "COMPLETE" },
      select: { id: true, type: true, addedAt: true },
      orderBy: { addedAt: "asc" },
    }),

    // Theme count
    prisma.theme.findMany({
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  // --- Review Heatmap (last 90 days) ---
  const heatmap: Record<string, { count: number; ratings: number[] }> = {};
  for (let d = 0; d < 90; d++) {
    const date = new Date(now.getTime() - d * 86400000).toISOString().split("T")[0];
    heatmap[date] = { count: 0, ratings: [0, 0, 0, 0] };
  }
  reviewLogs.forEach(log => {
    const day = new Date(log.reviewedAt).toISOString().split("T")[0];
    if (heatmap[day]) {
      heatmap[day].count++;
      heatmap[day].ratings[log.rating - 1]++;
    }
  });

  // --- Streak calculation ---
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  for (let d = 0; d < 90; d++) {
    const date = new Date(now.getTime() - d * 86400000).toISOString().split("T")[0];
    if (heatmap[date]?.count > 0) {
      tempStreak++;
      if (d === currentStreak) currentStreak = tempStreak; // contiguous from today
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // --- Retention over time (daily averages, last 30 days) ---
  const retentionByDay: { date: string; overall: number; byTheme: Record<string, number> }[] = [];
  for (let d = 29; d >= 0; d--) {
    const targetDate = new Date(now.getTime() - d * 86400000);
    const dateStr = targetDate.toISOString().split("T")[0];

    // Calculate what retention would have been on this date
    const themeRetentions: Record<string, { sum: number; count: number }> = {};
    let totalRet = 0;
    let totalCount = 0;

    allCards.forEach(card => {
      if (!card.lastReview || new Date(card.lastReview) > targetDate) return;
      const elapsed = (targetDate.getTime() - new Date(card.lastReview).getTime()) / 86400000;
      if (card.stability <= 0) return;
      const ret = Math.pow(1 + elapsed / (9 * card.stability), -1);
      totalRet += ret;
      totalCount++;

      card.claim.themes.forEach(t => {
        const name = t.theme.name;
        if (!themeRetentions[name]) themeRetentions[name] = { sum: 0, count: 0 };
        themeRetentions[name].sum += ret;
        themeRetentions[name].count++;
      });
    });

    const byTheme: Record<string, number> = {};
    Object.entries(themeRetentions).forEach(([name, { sum, count }]) => {
      byTheme[name] = count > 0 ? sum / count : 0;
    });

    retentionByDay.push({
      date: dateStr,
      overall: totalCount > 0 ? totalRet / totalCount : 0,
      byTheme,
    });
  }

  // --- Knowledge Growth (cumulative) ---
  const growthByDay: { date: string; claims: number; sources: number }[] = [];
  for (let d = 29; d >= 0; d--) {
    const targetDate = new Date(now.getTime() - d * 86400000);
    const dateStr = targetDate.toISOString().split("T")[0];
    const claimCount = allClaims.filter(c => new Date(c.createdAt) <= targetDate).length;
    const sourceCount = allSources.filter(s => new Date(s.addedAt) <= targetDate).length;
    growthByDay.push({ date: dateStr, claims: claimCount, sources: sourceCount });
  }

  // --- Claim Status Breakdown ---
  const statusCounts: Record<string, number> = { consensus: 0, supported: 0, emerging: 0, contested: 0, contradicted: 0 };
  allClaims.forEach(c => {
    const s = (c.status || "EMERGING").toLowerCase();
    if (s in statusCounts) statusCounts[s]++;
  });

  // --- Source Type Breakdown ---
  const sourceTypeCounts: Record<string, number> = {};
  allSources.forEach(s => {
    const type = (s.type || "ARTICLE").toLowerCase();
    sourceTypeCounts[type] = (sourceTypeCounts[type] || 0) + 1;
  });

  // --- Hardest Claims (most lapses or lowest stability) ---
  const hardClaims = [...allCards]
    .filter(c => c.reps > 0)
    .sort((a, b) => {
      // Sort by lapses desc, then stability asc
      if (b.lapses !== a.lapses) return b.lapses - a.lapses;
      return a.stability - b.stability;
    })
    .slice(0, 10)
    .map(card => ({
      id: card.claim.id,
      text: card.claim.text,
      status: card.claim.status,
      lapses: card.lapses,
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      themes: card.claim.themes.map(t => t.theme.name),
      retention: (() => {
        if (!card.lastReview || card.stability <= 0) return 0;
        const elapsed = (now.getTime() - new Date(card.lastReview).getTime()) / 86400000;
        return Math.pow(1 + elapsed / (9 * card.stability), -1);
      })(),
    }));

  // --- Rating distribution ---
  const ratingDist = [0, 0, 0, 0]; // Again, Hard, Good, Easy
  reviewLogs.forEach(log => { ratingDist[log.rating - 1]++; });
  const totalReviews = reviewLogs.length;

  // --- Reviews per day average ---
  const activeDays = Object.values(heatmap).filter(d => d.count > 0).length;
  const avgReviewsPerDay = activeDays > 0 ? totalReviews / activeDays : 0;

  // --- Current retention ---
  let currentRetention = 0;
  const activeCards = allCards.filter(c => c.lastReview !== null);
  if (activeCards.length > 0) {
    currentRetention = activeCards.reduce((sum, card) => {
      const fsrsCard: FSRSCard = {
        due: card.due, stability: card.stability, difficulty: card.difficulty,
        elapsedDays: card.elapsedDays, scheduledDays: card.scheduledDays,
        reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview,
      };
      return sum + fsrs.getRetrievability(fsrsCard);
    }, 0) / activeCards.length;
  }

  return NextResponse.json({
    success: true,
    data: {
      overview: {
        totalReviews,
        currentStreak,
        longestStreak,
        currentRetention,
        avgReviewsPerDay: Math.round(avgReviewsPerDay * 10) / 10,
        totalClaims: allClaims.length,
        totalSources: allSources.length,
        totalThemes: allThemes.length,
        dueNow: allCards.filter(c => new Date(c.due) <= now).length,
      },
      heatmap,
      retentionByDay,
      growthByDay,
      statusCounts,
      sourceTypeCounts,
      ratingDistribution: {
        again: ratingDist[0],
        hard: ratingDist[1],
        good: ratingDist[2],
        easy: ratingDist[3],
        total: totalReviews,
      },
      hardClaims,
    },
  });
}
