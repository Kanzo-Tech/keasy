/// <reference lib="webworker" />
/**
 * Fossil LSP Worker entry — boots @fossil-lang/wasm and delegates
 * LSP-over-postMessage dispatch to the Rust-side `start_lsp_worker()`.
 *
 * Mirror of the @fossil-lang/playground reference worker (ADR-0024:
 * `fossil-wasm` IS the LSP server-side; ADR-0026: the LSP Worker is long-lived,
 * host-singleton). `start_lsp_worker()` installs its own `self.onmessage` and
 * owns the full LSP dispatch (initialize, didOpen/didChange, completion, hover,
 * diagnostics, semanticTokens, …) plus the W3-editor `fossil/setTargetShex` +
 * `fossil/registerInferredDescriptor` methods. The TypeScript side never
 * re-implements any of that — this entry is a thin async boot wrapper.
 *
 * Boot protocol: the main thread posts `{ type: '__boot', wasmUrl }` first.
 * The Worker awaits `initFossilWasm`, calls `start_lsp_worker()` once, then
 * replays any messages that arrived before init resolved.
 */

import { initFossilWasm, start_lsp_worker } from "@fossil-lang/wasm";

declare const self: DedicatedWorkerGlobalScope;

const _preBoot: MessageEvent[] = [];
let _booted = false;

self.addEventListener("message", async (e: MessageEvent) => {
  if (_booted) {
    // After boot the Rust dispatcher owns onmessage; nothing to do here.
    return;
  }
  const data = e.data as { type?: string; wasmUrl?: string | URL };
  if (data && data.type === "__boot" && data.wasmUrl) {
    try {
      await initFossilWasm({ wasmUrl: data.wasmUrl });
      start_lsp_worker();
      _booted = true;
      for (const queued of _preBoot.splice(0)) {
        self.dispatchEvent(new MessageEvent("message", { data: queued.data }));
      }
    } catch (err) {
      self.postMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: `fossil lsp.worker boot failed: ${String(err)}`,
          },
        }),
      );
    }
  } else {
    // Non-boot message before init — queue; the Rust handler drains it post-boot.
    _preBoot.push(e);
  }
});

export {};
