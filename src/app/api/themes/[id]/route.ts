// GET/PATCH/DELETE /api/themes/[id]

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const theme = await prisma.theme.findUnique({
    where: { id },
    include: {
      sources: {
        include: {
          source: {
            select: {
              id: true, title: true, author: true, type: true,
              summary: true, publicationDate: true, url: true, addedAt: true,
            },
          },
        },
        orderBy: { source: { addedAt: "desc" } },
      },
      claims: {
        include: {
          claim: {
            include: {
              sources: {
                include: { source: { select: { id: true, title: true, author: true, type: true } } },
              },
              contradicts: {
                include: { contradicted: { select: { id: true, text: true, status: true } } },
              },
              contradictedBy: {
                include: { claim: { select: { id: true, text: true, status: true } } },
              },
              reviewCards: {
                select: { due: true, stability: true, state: true, lastReview: true, reps: true },
              },
            },
          },
        },
      },
    },
  });

  if (!theme) {
    return NextResponse.json({ success: false, error: "Theme not found" }, { status: 404 });
  }

  // Organize claims by status
  const claims = theme.claims.map((ct) => ct.claim);
  const organized = {
    consensus: claims.filter((c) => c.status === "CONSENSUS"),
    supported: claims.filter((c) => c.status === "SUPPORTED"),
    emerging: claims.filter((c) => c.status === "EMERGING"),
    contested: claims.filter((c) => c.status === "CONTESTED"),
    contradicted: claims.filter((c) => c.status === "CONTRADICTED"),
  };

  return NextResponse.json({
    success: true,
    data: {
      ...theme,
      claimsByStatus: organized,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const theme = await prisma.theme.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description,
      icon: body.icon,
      color: body.color,
      bgColor: body.bgColor,
    },
  });

  return NextResponse.json({ success: true, data: theme });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.theme.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
