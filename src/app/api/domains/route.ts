// GET /api/domains
// Returns all domains with aggregated stats

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fsrs } from "@/services/fsrs";
import type { FSRSCard } from "@/types";

const MVP_USER_ID = "user_mvp";

export async function GET(_request: NextRequest) {
  try {
    const domains = await prisma.domain.findMany({
      include: {
        themes: {
          include: {
            sources: { select: { sourceId: true } },
            claims: {
              include: {
                claim: {
                  include: {
                    reviewCards: {
                      where: { userId: MVP_USER_ID },
                      select: {
                        stability: true, difficulty: true, due: true,
                        elapsedDays: true, scheduledDays: true,
                        reps: true, lapses: true, state: true, lastReview: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const domainStats = domains.map((domain) => {
      // Deduplicate source IDs across all themes in this domain
      const sourceIds = new Set<string>();
      domain.themes.forEach(theme => theme.sources.forEach(s => sourceIds.add(s.sourceId)));

      // Collect all claims across themes
      const allClaims = domain.themes.flatMap(theme => theme.claims.map(ct => ct.claim));
      const claimCount = allClaims.length;

      // Compute average FSRS retention across all reviewed cards in this domain
      const allCards = allClaims.flatMap(claim => claim.reviewCards).filter(c => c.lastReview !== null);
      const avgRetention = allCards.length > 0
        ? allCards.reduce((sum, card) => {
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
          }, 0) / allCards.length
        : 0;

      return {
        id: domain.id,
        name: domain.name,
        slug: domain.slug,
        icon: domain.icon || "📂",
        color: domain.color || "#00e5ff",
        description: domain.description,
        themeCount: domain.themes.length,
        sourceCount: sourceIds.size,
        claimCount,
        avgRetention,
      };
    });

    // Only return domains that have themes or content
    const nonEmpty = domainStats.filter(d => d.themeCount > 0);

    return NextResponse.json({ success: true, data: nonEmpty });
  } catch (err: any) {
    console.error("Domains API error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
