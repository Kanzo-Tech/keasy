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
 * The singleton is exposed via `useSyncExternalStore` — the idiomatic way to
 * subscribe to an external mutable resource: SSR-safe (server snapshot is
 * `null`, no `Worker` on the server) and re-renders the consumer once the
 * worker boots, without a setState-in-effect.
 *
 * Returns a bare `Transport` for `<FossilEditor lspTransport={…}/>`'s
 * auto-compose path (it builds + owns its own LSPClient internally).
 */

import { useEffect, useSyncExternalStore } from "react";
import { createWorkerTransport, type Transport } from "@fossil-lang/editor";

// Static URL of the wasm artefact staged into public/ by scripts/copy-fossil-wasm.mjs
// (predev/prebuild). The worker fetches it via initFossilWasm({ wasmUrl }).
const WASM_URL = "/fossil/fossil_wasm_bg.wasm";

let _worker: Worker | null = null;
let _transport: Transport | null = null;
const _listeners = new Set<() => void>();

/** Create the worker + transport once (client-only), then notify subscribers. */
function ensureTransport(): void {
  if (_transport) return;
  _worker = new Worker(new URL("./lsp.worker.ts", import.meta.url), {
    type: "module",
  });
  _worker.postMessage({ type: "__boot", wasmUrl: WASM_URL });
  _transport = createWorkerTransport(_worker);
  for (const l of _listeners) l();
}

export function useFossilLspTransport(): Transport | null {
  const transport = useSyncExternalStore(
    (onChange) => {
      _listeners.add(onChange);
      return () => _listeners.delete(onChange);
    },
    () => _transport, // client snapshot
    () => null, // server snapshot (no Worker during SSR)
  );

  // Boot the singleton on mount (client-only). Idempotent — the module guard
  // short-circuits Strict Mode's second mount; no cleanup (ADR-0026).
  useEffect(() => {
    ensureTransport();
  }, []);

  return transport;
}
