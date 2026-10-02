import "server-only";

import type { Schemas } from "@keasy/api";

import { deadlineFetch } from "@/lib/deadline";

export type Branding = Schemas["Branding"];

/**
 * The instance's look, as its operator declared it (`KEASY_BRANDING_FILE`).
 *
 * Public and fixed for the life of the server process, so it is read once per
 * process rather than per request. An unreachable API is a deploy fault, not a
 * missing brand, so it is thrown.
 */
let cached: Promise<Branding> | undefined;

const bounded = deadlineFetch((ms) => new Error(`GET /v1/branding did not answer within ${ms / 1000} s`));

export function getBranding(): Promise<Branding> {
  if (cached) return cached;
  const read = bounded(`${process.env.KEASY_API_URL?.replace(/\/$/, "")}/v1/branding`, {
    cache: "no-store",
  }).then(async (res) => {
    if (!res.ok) throw new Error(`GET /v1/branding answered ${res.status}`);
    return (await res.json()) as Branding;
  });
  // A failed read is forgotten, so the next request asks again rather than the process keeping it.
  read.catch(() => {
    if (cached === read) cached = undefined;
  });
  cached = read;
  return read;
}
