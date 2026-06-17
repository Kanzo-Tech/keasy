import { useEffect, useState } from "react";
import { initFossilWasm } from "@fossil-lang/wasm";

// Staged into public/ by scripts/copy-fossil-wasm.mjs (predev/prebuild) — the
// SAME artefact the LSP worker boots (use-fossil-lsp-transport.ts).
const WASM_URL = "/fossil/fossil_wasm_bg.wasm";

/**
 * Instantiate `@fossil-lang/wasm` on the MAIN thread and report readiness.
 *
 * The codemirror syntax highlighter (`@fossil-lang/codemirror-fossil`'s
 * `fossil()` language) calls `@fossil-lang/wasm`'s `tokenize()` SYNCHRONOUSLY on
 * the main thread — separate from the LSP worker, which instantiates its own
 * copy in the worker realm. Without a main-thread init the first tokenize throws
 * `Cannot read properties of undefined (reading '__wbindgen_malloc…')`. Gate the
 * editor render on this so the language never tokenizes before the module loads.
 *
 * `initFossilWasm` is memoised, so multiple editors share one instantiation.
 */
export function useFossilWasmReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void initFossilWasm({ wasmUrl: WASM_URL })
      .then(() => {
        if (alive) setReady(true);
      })
      .catch((err) => console.error("fossil wasm init failed", err));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
