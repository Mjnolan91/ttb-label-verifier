import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Offline-by-default prototype: no remote image hosts, no rewrites.
  // Real extraction providers (Azure OpenAI / Document Intelligence) are opt-in via
  // environment variables only and never affect the default mock path.

  // Emit a self-contained server bundle (.next/standalone) for a small container image —
  // used by the Azure Container Apps Dockerfile (US-014). Harmless for `next start` / App Service.
  output: "standalone",
};

export default nextConfig;
