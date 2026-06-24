// /deep-research — server-component shell that deep-links into the Deep
// Research view. The app chrome (sidebar, neural background, view switching)
// lives in the NexusApp client component; this route just opens it on the
// right view.

import type { Metadata } from "next";
import NexusApp from "@/app/components/NexusApp";

export const metadata: Metadata = {
  title: "Deep Research — Nexus",
  description: "Plan, search, ingest, and synthesize cited research reports from the literature",
};

export default function DeepResearchPage() {
  return <NexusApp initialView="deep-research" />;
}
