import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Offline-by-default prototype: no remote image hosts, no rewrites.
  // Real extraction providers (Azure OpenAI / Document Intelligence) are opt-in via
  // environment variables only and never affect the default mock path.
};

export default nextConfig;
