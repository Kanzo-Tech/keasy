import {
  initFossilWasm,
  refs as wasmRefs,
  providers as wasmProviders,
  type SourceRefInfo,
  type ProviderInfo,
} from "@fossil-lang/wasm";

// Same artefact the editor + LSP worker boot (see use-fossil-wasm.ts);
// `initFossilWasm` is memoised, so the awaits below are cheap after the first.
const WASM_URL = "/fossil/fossil_wasm_bg.wasm";

export type { SourceRefInfo, ProviderInfo };

/**
 * A program's typed lineage — every external reference (`@conn` data + `schema =`),
 * each tagged with its alias and role. Client-compute: runs `@fossil-lang/wasm`'s
 * `refs()` in the browser, the SAME parse the native `fossil refs` runs. Replaces
 * the `/v1/refs` server round-trip (which subprocessed the `fossil` binary) — keasy
 * no longer owns fossil's semantics (host-boundary).
 */
export async function refs(program: string): Promise<SourceRefInfo[]> {
  await initFossilWasm({ wasmUrl: WASM_URL });
  return wasmRefs(program);
}

/**
 * The data-source providers fossil supports (`io.csv`, `io.rdf`, …). Client-compute
 * projection of fossil's source registry; replaces the `/v1/providers` subprocess.
 */
export async function providers(): Promise<ProviderInfo[]> {
  await initFossilWasm({ wasmUrl: WASM_URL });
  return wasmProviders();
}
