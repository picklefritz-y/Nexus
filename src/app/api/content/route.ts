// GET /api/content
// List all sources with optional filtering by type, theme, status

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const MVP_USER_ID = "user_mvp";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const themeId = searchParams.get("themeId");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const where: any = { userId: MVP_USER_ID };

  if (type) where.type = type;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { author: { contains: search, mode: "insensitive" } },
    ];
  }
  if (themeId) {
    where.themes = { some: { themeId } };
  }

  const [sources, total] = await Promise.all([
    prisma.source.findMany({
      where,
      include: {
        themes: { include: { theme: true } },
        claims: { select: { claimId: true } },
      },
      orderBy: { addedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.source.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: sources,
    pagination: { total, limit, offset },
  });
}
