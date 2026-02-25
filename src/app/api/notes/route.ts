// GET /api/notes — List notes with optional filters
// POST /api/notes — Create a new note

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const MVP_USER_ID = "user_mvp";

const noteIncludes = {
  source: { select: { id: true, title: true, type: true } },
  claim: { select: { id: true, text: true, status: true } },
  theme: { select: { id: true, name: true, icon: true, color: true } },
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");
    const claimId = searchParams.get("claimId");
    const themeId = searchParams.get("themeId");
    const topic = searchParams.get("topic");
    const search = searchParams.get("search");
    const limit = parseInt(searchParams.get("limit") || "100");

    const where: any = { userId: MVP_USER_ID };
    if (sourceId) where.sourceId = sourceId;
    if (claimId) where.claimId = claimId;
    if (themeId) where.themeId = themeId;
    if (topic) where.topic = topic;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    const notes = await prisma.note.findMany({
      where,
      include: noteIncludes,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ success: true, data: notes });
  } catch (err: any) {
    console.error("Notes list error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, sourceId, claimId, themeId, topic } = body;

    if (!content?.trim()) {
      return NextResponse.json({ success: false, error: "Content is required" }, { status: 400 });
    }

    // Enforce at most one entity link
    const links = [sourceId, claimId, themeId].filter(Boolean);
    if (links.length > 1) {
      return NextResponse.json({ success: false, error: "Note can link to at most one entity (source, claim, or theme)" }, { status: 400 });
    }

    const note = await prisma.note.create({
      data: {
        userId: MVP_USER_ID,
        title: title?.trim() || null,
        content: content.trim(),
        sourceId: sourceId || null,
        claimId: claimId || null,
        themeId: themeId || null,
        topic: (!sourceId && !claimId && !themeId && topic?.trim()) ? topic.trim() : null,
      },
      include: noteIncludes,
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (err: any) {
    console.error("Notes create error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
