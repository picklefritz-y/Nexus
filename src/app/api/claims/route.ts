// GET /api/claims
// List all claims with filtering, sorting, and relationship data

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  try {
  const { searchParams } = new URL(request.url);
  const themeId = searchParams.get("themeId");
  const domainSlug = searchParams.get("domain");
  const status = searchParams.get("status");
  const sortBy = searchParams.get("sortBy") || "confidence"; // confidence | retention | status | date
  const limit = parseInt(searchParams.get("limit") || "100");

  const where: any = {};

  if (status) where.status = status;
  if (themeId) {
    where.themes = { some: { themeId } };
  } else if (domainSlug) {
    where.themes = { some: { theme: { domain: { slug: domainSlug } } } };
  }

  // Determine sort order
  const orderBy: any = (() => {
    switch (sortBy) {
      case "confidence": return { confidence: "desc" };
      case "status": return { status: "asc" };
      case "date": return { createdAt: "desc" };
      default: return { confidence: "desc" };
    }
  })();

  const claims = await prisma.claim.findMany({
    where,
    include: {
      sources: {
        include: {
          source: {
            select: { id: true, title: true, author: true, type: true, url: true },
          },
        },
      },
      themes: {
        include: { theme: true },
      },
      contradicts: {
        include: {
          contradicted: { select: { id: true, text: true, status: true, confidence: true } },
        },
      },
      contradictedBy: {
        include: {
          claim: { select: { id: true, text: true, status: true, confidence: true } },
        },
      },
      reviewCards: {
        where: { userId: MVP_USER_ID },
        select: {
          id: true, due: true, stability: true, difficulty: true,
          reps: true, lapses: true, state: true, lastReview: true,
        },
      },
    },
    orderBy,
    take: limit,
  });

  return NextResponse.json({ success: true, data: claims });
  } catch (err: any) {
    console.error("Claims API error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
