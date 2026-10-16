import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev serves every organization at its own subdomain (acme.localhost:3000), as prod does.
  allowedDevOrigins: ["*.localhost"],
  // The workspace contract package ships TypeScript source.
  transpilePackages: ["@keasy/api"],
  experimental: {
    authInterrupts: true,
  },
  // The Content-Security-Policy is per request, with its nonce: `csp` in `lib/auth/server.ts`.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ],
};

export default nextConfig;
