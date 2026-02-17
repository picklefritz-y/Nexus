import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.DOCKER_BUILD === "true" ? { output: "standalone" } : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // For PDF uploads
    },
  },
  // Allow external images from Semantic Scholar, etc.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.semanticscholar.org" },
    ],
  },
};

export default nextConfig;
