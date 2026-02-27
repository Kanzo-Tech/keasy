import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const keycloakUrl =
      process.env.KEYCLOAK_INTERNAL_URL ?? "http://keycloak:8080";
    return [
      {
        source: "/auth/:path*",
        destination: `${keycloakUrl}/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
