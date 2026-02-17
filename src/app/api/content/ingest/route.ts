// POST /api/content/ingest
// Creates a source record immediately, then processes in background
// UI polls /api/content/[id] for status updates

import { NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/types";
import { detectSourceType } from "@/services/content-fetcher";
import prisma from "@/lib/prisma";
import { contentPipeline } from "@/services/content-pipeline";

const MVP_USER_ID = "user_mvp";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = IngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const url = parsed.data.url || parsed.data.doi || "";
    const sourceType = parsed.data.type || detectSourceType(url);

    // Create source record immediately so we have an ID to return
    const source = await prisma.source.create({
      data: {
        userId: MVP_USER_ID,
        type: sourceType,
        status: "PENDING",
        title: "Processing...",
        url: parsed.data.url,
        doi: parsed.data.doi,
        userNotes: parsed.data.userNotes,
      },
    });

    // Fire off the pipeline in background (don't await)
    contentPipeline.processExistingSource(
      MVP_USER_ID,
      source.id,
      parsed.data,
      (status, detail) => {
        console.log(`[Pipeline] ${source.id}: ${status} — ${detail}`);
      }
    ).catch(err => {
      console.error(`[Pipeline] ${source.id}: Failed —`, err.message);
    });

    return NextResponse.json({
      success: true,
      data: { sourceId: source.id },
    });
  } catch (error: any) {
    console.error("Ingestion error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Processing failed" },
      { status: 500 }
    );
  }
}
