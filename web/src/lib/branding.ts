import "server-only";

import type { Schemas } from "@keasy/api";

import { deadlineFetch } from "@/lib/deadline";
import { headers } from "next/headers";

import { serverOf, tenantOf } from "@/lib/tenant";

export type Branding = Schemas["Branding"];

/**
 * An organization's look, as its operator declared it (`KEASY_BRANDING_FILE` on its server).
 *
 * Public and fixed for the life of that server, so it is read once per organization rather than
 * per request. An unreachable server is a deploy fault, not a missing brand, so it is thrown, and
 * a failed read is forgotten so the next request asks again.
 */
const cached = new Map<string, Promise<Branding>>();

const bounded = deadlineFetch((ms) => new Error(`GET /v1/branding did not answer within ${ms / 1000} s`));

export function getBranding(tenant: string): Promise<Branding> {
  const known = cached.get(tenant);
  if (known) return known;
  const read = bounded(`${serverOf(tenant)}/v1/branding`, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error(`GET /v1/branding answered ${res.status}`);
    return (await res.json()) as Branding;
  });
  read.catch(() => {
    if (cached.get(tenant) === read) cached.delete(tenant);
  });
  cached.set(tenant, read);
  return read;
}

/**
 * The look of the organization this request addresses. A page on a host that addresses none never
 * renders — `proxy.ts` answers it 404 first — so reaching here without one is a routing fault.
 */
export async function currentBranding(): Promise<Branding> {
  const tenant = tenantOf((await headers()).get("host"));
  if (tenant === undefined) throw new Error("a page rendered on a host that addresses no organization");
  return getBranding(tenant);
}
