"use client";

/**
 * useFossilLspTransport — module-singleton Fossil LSP Worker + WorkerTransport.
 *
 * Replaces the server-side `HttpTransport(/v1/fossil/lsp)` path with the
 * browser WASM LSP worker (CONNECTION-SHAPE-MODEL decision b: editor analysis
 * runs browser-side; the server only serves signed URLs). Same pattern as the
 * @fossil-lang/playground reference (`useLspWorker`) + ADR-0026: the worker is
 * a long-lived host-singleton that survives React remounts (incl. Strict Mode
 * double-mount); the browser tears it down on tab close. No `reset` by design.
 *
 * 2.1 returns a bare `Transport` for `<FossilEditor lspTransport={…}/>`'s
 * auto-compose path (it builds + owns its own LSPClient internally). The
 * descriptor-push path (source-field completion) needs a host-held LSPClient
 * and lands in a later slice.
 */

import { useEffect, useState } from "react";
import { createWorkerTransport, type Transport } from "@fossil-lang/editor";

// Static URL of the wasm artefact staged into public/ by scripts/copy-fossil-wasm.mjs
// (predev/prebuild). The worker fetches it via initFossilWasm({ wasmUrl }).
const WASM_URL = "/fossil/fossil_wasm_bg.wasm";

let _worker: Worker | null = null;
let _transport: Transport | null = null;

export function useFossilLspTransport(): Transport | null {
  const [transport, setTransport] = useState<Transport | null>(_transport);

  useEffect(() => {
    if (_transport) {
      setTransport(_transport);
      return;
    }
    _worker = new Worker(new URL("./lsp.worker.ts", import.meta.url), {
      type: "module",
    });
    _worker.postMessage({ type: "__boot", wasmUrl: WASM_URL });
    _transport = createWorkerTransport(_worker);
    setTransport(_transport);
    // INTENTIONAL: no cleanup — long-lived singleton (ADR-0026). The module
    // guard above short-circuits Strict Mode's second mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return transport;
}
