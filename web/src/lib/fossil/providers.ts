import "client-only";

import type { ProviderInfo } from "@fossil-lang/wasm";

/** The provider that reads `path` as `kind`, by case-insensitive extension. */
export function providerFor(
  path: string,
  kind: "data" | "schema",
  providers: readonly ProviderInfo[],
): ProviderInfo | undefined {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return providers.find((p) => (p.kind === kind || p.kind === "both") && p.extensions.includes(ext));
}
