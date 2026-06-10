import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Offline-by-default prototype: no remote image hosts, no rewrites.
  // Real extraction providers (Azure OpenAI / Document Intelligence) are opt-in via
  // environment variables only and never affect the default mock path.

  // Emit a self-contained server bundle (.next/standalone) for a small container image —
  // used by the Azure Container Apps Dockerfile. Harmless for `next start` / App Service.
  output: "standalone",

  // Baseline hardening for a public, unauthenticated upload endpoint: don't advertise the
  // framework, and set the headers every security review checks first. CSP is intentionally
  // omitted for the prototype (Next's inline runtime would need nonces); clickjacking is
  // covered by X-Frame-Options.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
