// ============================================================
// Domain Migration Script
// Usage: npx tsx scripts/migrate-domains.ts
//
// Creates initial domains and assigns existing themes to them.
// ============================================================

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

// Define initial domains
const INITIAL_DOMAINS = [
  {
    name: "Psychedelic Science",
    slug: "psychedelic-science",
    icon: "🍄",
    color: "#a855f7",
    description: "Psilocybin, psychedelic compounds, clinical trials, and consciousness research",
  },
  {
    name: "AI & Technology",
    slug: "ai-technology",
    icon: "🤖",
    color: "#00e5ff",
    description: "Artificial intelligence, machine learning, automation, and technology trends",
  },
  {
    name: "Health & Longevity",
    slug: "health-longevity",
    icon: "🧬",
    color: "#00e676",
    description: "Neuroscience, metabolomics, nutrition, longevity, and biomarkers",
  },
  {
    name: "Economics & Finance",
    slug: "economics-finance",
    icon: "📈",
    color: "#ffd600",
    description: "Economic theory, markets, monetary policy, and financial systems",
  },
  {
    name: "General",
    slug: "general",
    icon: "📚",
    color: "#9e9e9e",
    description: "Miscellaneous topics not fitting other domains",
  },
];

// Map theme name patterns to domain slugs
const THEME_TO_DOMAIN: Record<string, string> = {
  // Psychedelic Science themes
  "entourage effects": "psychedelic-science",
  "neuroplasticity": "psychedelic-science",
  "metabolomics": "psychedelic-science",
  "consumer attitudes": "psychedelic-science",
  "environmental impact": "psychedelic-science",
  "psilocybin": "psychedelic-science",
  "psychedelic": "psychedelic-science",
  "clinical": "psychedelic-science",
  "consciousness": "psychedelic-science",
  "microdosing": "psychedelic-science",
  "serotonin": "psychedelic-science",

  // AI & Technology themes
  "ai tools": "ai-technology",
  "ai benchmarks": "ai-technology",
  "ai economic impact": "ai-technology",
  "ai skills": "ai-technology",
  "ai performance": "ai-technology",
  "workforce transformation": "ai-technology",
  "automation": "ai-technology",
  "machine learning": "ai-technology",
  "large language": "ai-technology",

  // Health & Longevity themes
  "mitochondrial": "health-longevity",
  "metabolic health": "health-longevity",
  "strength training": "health-longevity",
  "longevity": "health-longevity",
  "neuroscience": "health-longevity",
  "sleep": "health-longevity",
  "cardiovascular": "health-longevity",
  "nutrition": "health-longevity",
  "peptide": "health-longevity",
  "hormonal": "health-longevity",

  // Economics & Finance themes
  "monetary policy": "economics-finance",
  "economics": "economics-finance",
  "finance": "economics-finance",
  "precious metals": "economics-finance",
  "investment": "economics-finance",
};

function assignDomain(themeName: string): string {
  const lower = themeName.toLowerCase();
  for (const [pattern, domainSlug] of Object.entries(THEME_TO_DOMAIN)) {
    if (lower.includes(pattern)) return domainSlug;
  }
  return "general";
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  🔮 NEXUS — Domain Migration");
  console.log("═".repeat(60));

  // Step 1: Create domains
  console.log("\n[1/3] Creating domains...");
  const domainMap = new Map<string, string>(); // slug → id

  for (const d of INITIAL_DOMAINS) {
    const domain = await prisma.domain.upsert({
      where: { slug: d.slug },
      update: { name: d.name, icon: d.icon, color: d.color, description: d.description },
      create: { name: d.name, slug: d.slug, icon: d.icon, color: d.color, description: d.description },
    });
    domainMap.set(d.slug, domain.id);
    console.log(`  ✅ ${d.icon} ${d.name} (${domain.id})`);
  }

  // Step 2: Fetch all existing themes
  console.log("\n[2/3] Fetching existing themes...");
  const themes = await prisma.theme.findMany({ select: { id: true, name: true, domainId: true } });
  console.log(`  Found ${themes.length} themes`);

  // Step 3: Assign each theme to a domain
  console.log("\n[3/3] Assigning themes to domains...");
  let assigned = 0;
  let skipped = 0;

  for (const theme of themes) {
    if (theme.domainId) {
      console.log(`  ⏭  ${theme.name} — already assigned`);
      skipped++;
      continue;
    }

    const domainSlug = assignDomain(theme.name);
    const domainId = domainMap.get(domainSlug);

    if (!domainId) {
      console.log(`  ⚠️  ${theme.name} — could not find domain "${domainSlug}"`);
      continue;
    }

    await prisma.theme.update({ where: { id: theme.id }, data: { domainId } });

    const domain = INITIAL_DOMAINS.find(d => d.slug === domainSlug);
    console.log(`  ${domain?.icon || "📂"} ${theme.name} → ${domain?.name || domainSlug}`);
    assigned++;
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ MIGRATION COMPLETE");
  console.log("═".repeat(60));
  console.log(`\n  Domains created: ${INITIAL_DOMAINS.length}`);
  console.log(`  Themes assigned: ${assigned}`);
  console.log(`  Themes skipped (already had domain): ${skipped}\n`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error("\n❌ Migration error:", e.message);
  process.exit(1);
});
