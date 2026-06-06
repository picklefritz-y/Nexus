// POST /api/deep-research/start
// Accepts { query: string }
// Creates a DeepResearchQuery, runs the planner, persists subqueries,
// and returns { queryId, subqueries }.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { planResearch } from "@/lib/deep-research/planner";

const MVP_USER_ID = "user_mvp";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { success: false, error: "query is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const originalQuery = body.query.trim();

  // Create the query record immediately so we always have an ID to update
  const deepQuery = await prisma.deepResearchQuery.create({
    data: {
      userId: MVP_USER_ID,
      originalQuery,
      status: "PLANNING",
    },
  });

  try {
    // Phase 1: plan
    const { subqueries } = await planResearch(originalQuery);

    // Persist subqueries
    await prisma.deepResearchSubquery.createMany({
      data: subqueries.map((sq, i) => ({
        parentQueryId: deepQuery.id,
        text: sq.text,
        rationale: sq.rationale,
        order: i,
      })),
    });

    // Advance status — Phase 2 (search) is not yet implemented
    await prisma.deepResearchQuery.update({
      where: { id: deepQuery.id },
      data: { status: "SEARCHING" },
    });

    return NextResponse.json({
      success: true,
      data: {
        queryId: deepQuery.id,
        subqueries,
      },
    });
  } catch (error: any) {
    // Mark as failed so the UI can surface it
    await prisma.deepResearchQuery.update({
      where: { id: deepQuery.id },
      data: {
        status: "FAILED",
        errorMessage: error?.message ?? "Unknown error",
      },
    }).catch(() => {
      // Best-effort — don't mask the original error
    });

    console.error("[deep-research/start] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message ?? "Research planning failed" },
      { status: 500 }
    );
  }
}
