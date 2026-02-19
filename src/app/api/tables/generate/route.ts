// GET /api/search?q=keyword
// Searches across claims, sources, and themes in one call

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const limit = parseInt(searchParams.get("limit") || "20");

  if (!q || q.length < 2) {
    return NextResponse.json({ success: true, data: { claims: [], sources: [], themes: [] } });
  }

  const [claims, sources, themes] = await Promise.all([
    // Search claims by text, explanation, implications
    prisma.claim.findMany({
      where: {
        OR: [
          { text: { contains: q, mode: "insensitive" } },
          { explanation: { contains: q, mode: "insensitive" } },
          { implications: { contains: q, mode: "insensitive" } },
        ],
      },
      include: {
        sources: {
          include: {
            source: { select: { id: true, title: true, author: true, type: true } },
          },
        },
        themes: {
          include: { theme: { select: { id: true, name: true, color: true, icon: true } } },
        },
        contradicts: {
          include: { contradicted: { select: { id: true, text: true, status: true } } },
        },
        contradictedBy: {
          include: { claim: { select: { id: true, text: true, status: true } } },
        },
        reviewCards: {
          where: { userId: MVP_USER_ID },
          select: {
            id: true, due: true, stability: true, difficulty: true,
            reps: true, lapses: true, state: true, lastReview: true,
          },
        },
      },
      orderBy: { confidence: "desc" },
      take: limit,
    }),

    // Search sources by title, author, summary
    prisma.source.findMany({
      where: {
        userId: MVP_USER_ID,
        status: "COMPLETE",
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { author: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
        ],
      },
      include: {
        themes: { include: { theme: { select: { name: true, color: true, icon: true } } } },
        claims: { select: { claimId: true } },
      },
      orderBy: { addedAt: "desc" },
      take: limit,
    }),

    // Search themes by name
    prisma.theme.findMany({
      where: {
        name: { contains: q, mode: "insensitive" },
      },
      include: {
        sources: { select: { sourceId: true } },
        claims: { select: { claimId: true } },
      },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: { claims, sources, themes },
    query: q,
  });
}
