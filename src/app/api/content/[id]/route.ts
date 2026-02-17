// GET /api/content/[id]
// Returns a single source with its claims, themes, and processing status

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const source = await prisma.source.findUnique({
    where: { id },
    include: {
      claims: {
        include: {
          claim: {
            include: {
              themes: { include: { theme: true } },
              contradicts: {
                include: { contradicted: { select: { id: true, text: true, status: true } } },
              },
              contradictedBy: {
                include: { claim: { select: { id: true, text: true, status: true } } },
              },
            },
          },
        },
      },
      themes: {
        include: { theme: true },
      },
    },
  });

  if (!source) {
    return NextResponse.json(
      { success: false, error: "Source not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: source });
}

// DELETE /api/content/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.source.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
