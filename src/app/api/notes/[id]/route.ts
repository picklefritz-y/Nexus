// GET /api/notes/:id — Fetch single note
// PATCH /api/notes/:id — Update note
// DELETE /api/notes/:id — Delete note

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const noteIncludes = {
  source: { select: { id: true, title: true, type: true, author: true } },
  claim: { select: { id: true, text: true, status: true, confidence: true } },
  theme: { select: { id: true, name: true, icon: true, color: true } },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const note = await prisma.note.findUnique({
      where: { id },
      include: noteIncludes,
    });
    if (!note) {
      return NextResponse.json({ success: false, error: "Note not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: note });
  } catch (err: any) {
    console.error("Note get error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = body.title?.trim() || null;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.topic !== undefined) updateData.topic = body.topic?.trim() || null;

    const note = await prisma.note.update({
      where: { id },
      data: updateData,
      include: noteIncludes,
    });

    return NextResponse.json({ success: true, data: note });
  } catch (err: any) {
    console.error("Note update error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.note.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Note delete error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
