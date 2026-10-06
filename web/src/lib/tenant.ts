import "server-only";

/**
 * The organization a host addresses: `acme` in `acme.<KEASY_BASE_DOMAIN>`, and nothing for the bare
 * domain or any other host. One web serves every organization — Keycloak's Organizations model, one
 * client shared by all of them — and the subdomain is how a request says which.
 */
export function tenantOf(hostname: string | null | undefined): string | undefined {
  const base = process.env.KEASY_BASE_DOMAIN?.trim();
  if (!base || !hostname) return undefined;
  const host = hostname.split(":")[0].toLowerCase();
  if (!host.endsWith(`.${base}`)) return undefined;
  const label = host.slice(0, -base.length - 1);
  return /^[a-z0-9-]+$/.test(label) ? label : undefined;
}

/** The organization's own server: `KEASY_API_URL`, with `{tenant}` standing for its alias. */
export function serverOf(tenant: string): string {
  const template = process.env.KEASY_API_URL?.trim();
  if (!template) throw new Error("KEASY_API_URL is required — it names each organization's server");
  return template.replaceAll("{tenant}", tenant).replace(/\/$/, "");
}
