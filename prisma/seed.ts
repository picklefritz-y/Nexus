// ============================================================
// Database Seed Script
// Run: npx tsx prisma/seed.ts
// Populates the database with sample data for development
// ============================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Nexus database...\n");

  // --- Create MVP user ---
  const user = await prisma.user.upsert({
    where: { id: "user_mvp" },
    update: {},
    create: {
      id: "user_mvp",
      email: "dev@nexus.local",
      name: "Dev User",
    },
  });
  console.log(`✓ User: ${user.name}`);

  // --- Create themes ---
  const themeData = [
    { name: "Mitochondrial Function", slug: "mitochondrial-function", icon: "⚡", color: "#e040fb", bgColor: "#1a0a2e" },
    { name: "Metabolic Health", slug: "metabolic-health", icon: "🔬", color: "#00e5ff", bgColor: "#0a1628" },
    { name: "Strength Training", slug: "strength-training", icon: "💪", color: "#ff6d00", bgColor: "#1a0f0a" },
    { name: "Precious Metals", slug: "precious-metals", icon: "🥇", color: "#ffd600", bgColor: "#0f1a0a" },
    { name: "Neuroscience", slug: "neuroscience", icon: "🧠", color: "#7c4dff", bgColor: "#0a0f1a" },
    { name: "Longevity", slug: "longevity", icon: "🧬", color: "#00e676", bgColor: "#0a1a14" },
    { name: "Nutrition", slug: "nutrition", icon: "🥗", color: "#ff4081", bgColor: "#1a0a0f" },
    { name: "Sleep Science", slug: "sleep-science", icon: "😴", color: "#448aff", bgColor: "#0a0a1a" },
  ];

  const themes: Record<string, string> = {};
  for (const t of themeData) {
    const theme = await prisma.theme.upsert({
      where: { slug: t.slug },
      update: t,
      create: t,
    });
    themes[t.name] = theme.id;
  }
  console.log(`✓ Themes: ${Object.keys(themes).length} created`);

  // --- Create sources ---
  const sourcesData = [
    {
      type: "PODCAST" as const,
      title: "Huberman Lab #127: Mitochondria & Cellular Energy",
      author: "Andrew Huberman",
      publicationDate: new Date("2025-01-15"),
      summary: "Deep dive into mitochondrial biogenesis pathways, the role of PGC-1α in energy metabolism, and practical protocols for enhancing mitochondrial function through cold exposure and exercise.",
      url: "https://hubermanlab.com/episode-127",
      themes: ["Mitochondrial Function", "Metabolic Health"],
    },
    {
      type: "PAPER" as const,
      title: "Zone 2 Training Upregulates PGC-1α via AMPK-Dependent Pathway",
      author: "Iñigo San Millán et al.",
      publicationDate: new Date("2024-11-20"),
      summary: "Randomized controlled trial demonstrating Zone 2 aerobic training significantly increases mitochondrial density and PGC-1α expression in skeletal muscle over 12 weeks.",
      doi: "10.1234/example-z2",
      themes: ["Mitochondrial Function", "Strength Training"],
    },
    {
      type: "PODCAST" as const,
      title: "Peter Attia Drive #298: Rethinking Exercise Intensity Thresholds",
      author: "Peter Attia",
      publicationDate: new Date("2025-02-01"),
      summary: "Guest argues that fixed zone thresholds oversimplify metabolic response, presenting data showing individual variability in lactate clearance rates.",
      themes: ["Mitochondrial Function", "Strength Training"],
    },
    {
      type: "ARTICLE" as const,
      title: "Thread: Gold's Role as Inflation Hedge in 2025",
      author: "@LukeGromen",
      publicationDate: new Date("2025-01-28"),
      summary: "Analysis of gold's performance relative to M2 money supply expansion, arguing that real rates remain deeply negative when accounting for true inflation metrics.",
      url: "https://x.com/lukeGromen/status/example",
      themes: ["Precious Metals"],
    },
    {
      type: "PAPER" as const,
      title: "Creatine Monohydrate Enhances Mitochondrial Respiration in Aged Muscle",
      author: "Tarnopolsky et al.",
      publicationDate: new Date("2024-09-14"),
      summary: "Study showing creatine supplementation improves Complex I and II activity in mitochondria of older adults.",
      themes: ["Mitochondrial Function", "Strength Training", "Longevity"],
    },
    {
      type: "PODCAST" as const,
      title: "Rhonda Patrick: NAD+ Precursors and Mitochondrial Aging",
      author: "Rhonda Patrick",
      publicationDate: new Date("2025-01-10"),
      summary: "Review of NR and NMN supplementation literature, concluding that while NAD+ levels increase, downstream effects on mitochondrial function remain inconsistent.",
      themes: ["Mitochondrial Function", "Longevity"],
    },
    {
      type: "PAPER" as const,
      title: "Sleep Architecture and Mitochondrial DNA Repair Mechanisms",
      author: "Walker, M. et al.",
      publicationDate: new Date("2024-12-05"),
      summary: "First evidence that deep sleep phases directly activate mitochondrial DNA repair enzymes.",
      themes: ["Mitochondrial Function", "Sleep Science"],
    },
    {
      type: "ARTICLE" as const,
      title: "Central Bank Gold Purchases Signal Monetary Regime Change",
      author: "@ZeroHedge",
      publicationDate: new Date("2025-02-05"),
      summary: "Analysis of record central bank gold buying in 2024-2025, arguing this represents a structural shift away from USD-denominated reserves.",
      url: "https://zerohedge.com/example",
      themes: ["Precious Metals"],
    },
  ];

  const sourceIds: string[] = [];
  for (const s of sourcesData) {
    const { themes: themeNames, ...sourceFields } = s;
    const source = await prisma.source.create({
      data: {
        ...sourceFields,
        userId: user.id,
        status: "COMPLETE",
      },
    });
    sourceIds.push(source.id);

    // Link source to themes
    for (const themeName of themeNames) {
      if (themes[themeName]) {
        await prisma.sourceTheme.create({
          data: { sourceId: source.id, themeId: themes[themeName] },
        });
      }
    }
  }
  console.log(`✓ Sources: ${sourceIds.length} created`);

  // --- Create claims ---
  const claimsData = [
    {
      text: "Zone 2 cardio upregulates mitochondrial biogenesis via PGC-1α activation",
      status: "CONSENSUS" as const,
      confidence: 0.92,
      explanation: "Multiple studies demonstrate that sustained aerobic exercise at lactate threshold intensity activates AMPK, which in turn upregulates PGC-1α, the master regulator of mitochondrial biogenesis.",
      implications: "150-180 min/week of Zone 2 cardio should be a cornerstone of any longevity-focused exercise program.",
      themes: ["Mitochondrial Function", "Strength Training"],
      sourceIndices: [0, 1],
      fsrs: { stability: 8, difficulty: 3, reps: 4, state: 2, daysAgo: 2, dueDays: 5 },
    },
    {
      text: "Fixed exercise zone thresholds are individually variable and the Zone 2 framework may oversimplify metabolic response",
      status: "EMERGING" as const,
      confidence: 0.45,
      explanation: "Data presented showing lactate clearance rates vary significantly between individuals, suggesting that a fixed heart rate zone doesn't reliably correspond to the metabolic state of interest.",
      implications: "May need individualized lactate testing rather than relying on generic heart rate formulas.",
      themes: ["Mitochondrial Function", "Strength Training"],
      sourceIndices: [2],
      contradicts: [0], // contradicts claim index 0
      fsrs: { stability: 2, difficulty: 5, reps: 1, state: 2, daysAgo: 1, dueDays: 1 },
    },
    {
      text: "Creatine monohydrate enhances mitochondrial Complex I and II activity in aged muscle tissue",
      status: "SUPPORTED" as const,
      confidence: 0.78,
      explanation: "Controlled study in adults over 60 showed significant improvements in mitochondrial respiratory chain complex activity after 12 weeks of 5g/day creatine supplementation.",
      implications: "Creatine supplementation may serve double duty — supporting both muscle strength and mitochondrial health in aging populations.",
      themes: ["Mitochondrial Function", "Strength Training", "Longevity"],
      sourceIndices: [4],
      fsrs: { stability: 5, difficulty: 4, reps: 2, state: 2, daysAgo: 3, dueDays: -1 },
    },
    {
      text: "NAD+ precursors (NR/NMN) increase NAD+ levels but downstream mitochondrial function benefits remain inconsistent",
      status: "CONTESTED" as const,
      confidence: 0.55,
      explanation: "While blood and tissue NAD+ levels reliably increase with supplementation, RCTs have not consistently shown improvements in mitochondrial output, exercise performance, or aging biomarkers.",
      implications: "NR/NMN supplementation may raise NAD+ without the hoped-for functional benefits. More targeted interventions may be needed.",
      themes: ["Mitochondrial Function", "Longevity"],
      sourceIndices: [5],
      fsrs: { stability: 3, difficulty: 6, reps: 2, state: 2, daysAgo: 4, dueDays: -2 },
    },
    {
      text: "Deep sleep phases directly activate mitochondrial DNA repair enzymes",
      status: "EMERGING" as const,
      confidence: 0.65,
      explanation: "Novel finding from Walker et al. using real-time mitochondrial imaging during polysomnography, showing burst activation of OGG1 and POLG during N3 sleep.",
      implications: "Sleep deprivation may accelerate mitochondrial aging through impaired DNA repair, adding another mechanism to the health costs of poor sleep.",
      themes: ["Mitochondrial Function", "Sleep Science"],
      sourceIndices: [6],
      fsrs: { stability: 4, difficulty: 5, reps: 1, state: 2, daysAgo: 2, dueDays: 0 },
    },
    {
      text: "Gold outperforms equities when real interest rates are negative after adjusting for true inflation",
      status: "CONSENSUS" as const,
      confidence: 0.82,
      explanation: "Historical analysis across multiple monetary regimes shows gold consistently appreciates when the real yield on government bonds turns negative using broad inflation measures.",
      implications: "In the current environment of financial repression, gold allocation may serve as both a hedge and a growth asset.",
      themes: ["Precious Metals"],
      sourceIndices: [3, 7],
      fsrs: { stability: 6, difficulty: 3, reps: 3, state: 2, daysAgo: 1, dueDays: 4 },
    },
    {
      text: "Central bank gold purchases in 2024-2025 represent a structural shift away from USD reserves, not cyclical buying",
      status: "EMERGING" as const,
      confidence: 0.58,
      explanation: "Record purchases by China, India, and central/eastern European central banks show a sustained multi-year trend that breaks from historical patterns of cyclical reserve adjustments.",
      implications: "If structural, this could fundamentally alter the gold market's supply/demand dynamics and support higher gold prices for years to come.",
      themes: ["Precious Metals"],
      sourceIndices: [7],
      fsrs: { stability: 2, difficulty: 5, reps: 1, state: 2, daysAgo: 5, dueDays: -3 },
    },
    {
      text: "Cold exposure increases brown adipose tissue activation and mitochondrial thermogenesis",
      status: "CONSENSUS" as const,
      confidence: 0.88,
      explanation: "Well-established mechanism: cold exposure activates UCP1 in brown adipose tissue, decoupling the electron transport chain to produce heat, which increases total mitochondrial activity.",
      implications: "Regular cold exposure (cold showers, ice baths) may be a practical tool for improving metabolic health and mitochondrial function.",
      themes: ["Mitochondrial Function", "Metabolic Health"],
      sourceIndices: [0],
      fsrs: { stability: 10, difficulty: 2, reps: 5, state: 2, daysAgo: 1, dueDays: 8 },
    },
  ];

  const claimIds: string[] = [];
  for (const c of claimsData) {
    const { themes: themeNames, sourceIndices, contradicts, fsrs: fsrsData, ...claimFields } = c;

    const now = Date.now();
    const claim = await prisma.claim.create({ data: claimFields });
    claimIds.push(claim.id);

    // Link to sources
    for (const si of sourceIndices) {
      await prisma.claimSource.create({
        data: { claimId: claim.id, sourceId: sourceIds[si] },
      });
    }

    // Link to themes
    for (const tn of themeNames) {
      if (themes[tn]) {
        await prisma.claimTheme.create({
          data: { claimId: claim.id, themeId: themes[tn] },
        });
      }
    }

    // Create FSRS review card
    const dueDate = new Date(now + fsrsData.dueDays * 86400000);
    const lastReview = new Date(now - fsrsData.daysAgo * 86400000);
    await prisma.reviewCard.create({
      data: {
        userId: user.id,
        claimId: claim.id,
        due: dueDate,
        stability: fsrsData.stability,
        difficulty: fsrsData.difficulty,
        reps: fsrsData.reps,
        state: fsrsData.state,
        lastReview: lastReview,
        elapsedDays: fsrsData.daysAgo,
        scheduledDays: fsrsData.stability * 0.9,
        lapses: 0,
      },
    });
  }
  console.log(`✓ Claims: ${claimIds.length} created with review cards`);

  // --- Create contradictions ---
  for (let i = 0; i < claimsData.length; i++) {
    const c = claimsData[i];
    if (c.contradicts) {
      for (const targetIndex of c.contradicts) {
        await prisma.contradiction.create({
          data: {
            claimId: claimIds[i],
            contradictedId: claimIds[targetIndex],
            explanation: `"${claimsData[i].text}" challenges "${claimsData[targetIndex].text}" by suggesting the framework may not apply universally.`,
            severity: 0.6,
          },
        });
      }
    }
  }
  console.log(`✓ Contradictions linked`);

  // --- Seed some review logs ---
  const reviewCard = await prisma.reviewCard.findFirst({
    where: { userId: user.id },
  });
  if (reviewCard) {
    for (let i = 0; i < 5; i++) {
      await prisma.reviewLog.create({
        data: {
          userId: user.id,
          cardId: reviewCard.id,
          rating: [3, 3, 4, 2, 3][i],
          reviewedAt: new Date(Date.now() - (6 - i) * 86400000),
          prevStability: 2 + i,
          prevDifficulty: 4,
          prevState: 2,
          newStability: 2.5 + i,
          newDifficulty: 4,
          newState: 2,
          scheduledDays: 3 + i * 2,
          promptType: ["recall", "reflection", "correlation", "recall", "reflection"][i],
        },
      });
    }
    console.log(`✓ Sample review logs created`);
  }

  console.log("\n✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
