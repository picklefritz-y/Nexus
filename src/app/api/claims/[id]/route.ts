// GET/PATCH /api/claims/[id]

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      sources: {
        include: {
          source: { select: { id: true, title: true, author: true, type: true, url: true, summary: true } },
        },
      },
      themes: { include: { theme: true } },
      contradicts: {
        include: {
          contradicted: {
            include: {
              sources: { include: { source: { select: { title: true, author: true } } } },
            },
          },
        },
      },
      contradictedBy: {
        include: {
          claim: {
            include: {
              sources: { include: { source: { select: { title: true, author: true } } } },
            },
          },
        },
      },
    },
  });

  if (!claim) {
    return NextResponse.json({ success: false, error: "Claim not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: claim });
}

// PATCH - manually update claim status or confidence
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const allowedFields = ["status", "confidence", "explanation", "implications"];
  const updateData: any = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) updateData[field] = body[field];
  }

  const claim = await prisma.claim.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ success: true, data: claim });
}
