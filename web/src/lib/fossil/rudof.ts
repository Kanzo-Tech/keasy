import type { Mapping } from "@kanzo-tech/rudof-wasm";

import { queryClient } from "@/lib/api/query-client";

/**
 * rudof's wasm module, instantiated once and only when something reads RDF: the graph's mapping
 * (`GraphScope`, after its first paint) and the rules. A failed instantiation is not kept: the next
 * read tries again.
 */
export function rudof() {
  return queryClient.fetchQuery({
    queryKey: ["rudof"],
    queryFn: async () => {
      const rudofWasm = await import("@kanzo-tech/rudof-wasm");
      await rudofWasm.default();
      return rudofWasm;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** `mapping.ttl` as rudof reads it: RML-Core, which `model()` says per table and `triples()` renders as a relation. */
export async function parseMapping(text: string): Promise<Mapping> {
  const { Mapping } = await rudof();
  return Mapping.parse(text);
}
