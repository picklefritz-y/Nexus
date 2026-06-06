// GET /api/deep-research/[id]
// Returns the full DeepResearchQuery — subqueries, report (if any),
// and cited sources. Intended for UI polling.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const query = await prisma.deepResearchQuery.findUnique({
    where: { id },
    include: {
      subqueries: {
        orderBy: { order: "asc" },
      },
      report: {
        include: {
          sources: {
            include: {
              source: {
                select: {
                  id: true,
                  title: true,
                  author: true,
                  url: true,
                  type: true,
                },
              },
            },
            orderBy: { relevanceScore: "desc" },
          },
        },
      },
    },
  });

  if (!query) {
    return NextResponse.json(
      { success: false, error: "Deep research query not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: query });
}
