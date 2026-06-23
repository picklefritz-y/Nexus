// GET /api/deep-research/list
// Returns past DeepResearchQuery rows for user_mvp, newest first, each with
// subqueries and (if generated) the report + cited sources. Used to hydrate
// the Deep Research view on load; the same include shape as /[id] so polled
// rows can be swapped in without re-mapping.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const MVP_USER_ID = "user_mvp";

// No request params are read, so without this Next could treat the handler as
// static; the list must reflect live watcher progress on every call.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queries = await prisma.deepResearchQuery.findMany({
      where: { userId: MVP_USER_ID },
      orderBy: { createdAt: "desc" },
      take: 50,
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

    return NextResponse.json({ success: true, data: queries });
  } catch (err: any) {
    console.error("[deep-research/list] Error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
