import "server-only";

import type { Schemas } from "@keasy/api";

export type Branding = Schemas["Branding"];

/**
 * The instance's look, as its operator declared it (`KEASY_BRANDING_FILE`).
 *
 * Public and fixed for the life of the server process, so it is read once per
 * process rather than per request. An unreachable API is a deploy fault, not a
 * missing brand, so it is thrown.
 */
let cached: Promise<Branding> | undefined;

export function getBranding(): Promise<Branding> {
  cached ??= fetch(`${process.env.KEASY_API_URL?.replace(/\/$/, "")}/v1/branding`, {
    cache: "no-store",
  }).then(async (res) => {
    if (!res.ok) throw new Error(`GET /v1/branding answered ${res.status}`);
    return (await res.json()) as Branding;
  });
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}
