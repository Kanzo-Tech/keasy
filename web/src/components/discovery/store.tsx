/**
 * Discovery Store — Zustand, no SQLRooms.
 *
 * Boots DuckDB WASM through Mosaic's wasmConnector, lends the signed URLs to
 * DuckDB's file registry, and opens the corpus. `open` is the single door:
 * it registers the relations the verbs name (`"Person"`, `"Person_knows_Person"`)
 * over the paths the GraphAr manifests already gave it, so keasy mounts no views
 * of its own and the charts, the crossfilter and the verbs read the same names.
 */

"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { create, type StoreApi, useStore as useZustandStore } from "zustand";
import type { Coordinator } from "@uwdata/mosaic-core";
import { open, type QueryRow, type SchemaResult, type SqlCorpus } from "@fossil-lang/corpus";

import { initMosaic, type MosaicInstance } from "@/lib/mosaic";
import { registerDataSpace } from "@/lib/data-space";

// fossil-graph-wasm, staged into public/ by scripts/copy-fossil-wasm.mjs
// (predev/prebuild) — Next resolves no `.wasm` asset for us.
const GRAPH_WASM_URL = "/fossil/fossil_graph_wasm_bg.wasm";

// ── State ─────────────────────────────────────────────────────────────────

export interface DiscoveryState {
  status: "idle" | "initializing" | "ready" | "error";
  error: string | null;
  db: MosaicInstance["db"] | null;
  conn: MosaicInstance["conn"] | null;
  coordinator: Coordinator | null;
  /** The corpus — the single source for every discrete read. */
  corpus: SqlCorpus | null;
  /** What the schema verb answered, read once at boot. */
  schema: SchemaResult | null;
  /** The GraphAr manifests, kept so a canvas can address a type without refetching. */
  manifestFiles: Record<string, string>;
}

function createDiscoveryStore() {
  return create<DiscoveryState>(() => ({
    status: "idle",
    error: null,
    db: null,
    conn: null,
    coordinator: null,
    corpus: null,
    schema: null,
    manifestFiles: {},
  }));
}

// ── Context ───────────────────────────────────────────────────────────────

const StoreCtx = createContext<StoreApi<DiscoveryState> | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────

function DiscoveryRoom({
  signedUrls,
  manifestFiles,
  children,
}: {
  signedUrls: Record<string, string>;
  manifestFiles: Record<string, string>;
  children: ReactNode;
}) {
  const [store] = useState(createDiscoveryStore);

  const status = useZustandStore(store, (s) => s.status);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    store.setState({ status: "initializing" });

    initMosaic()
      .then(async ({ coordinator, db, conn }) => {
        await registerDataSpace(db, conn, signedUrls);
        const query = async (sql: string): Promise<QueryRow[]> =>
          (await coordinator.query(sql, { type: "json" })) as QueryRow[];
        // The base is empty because the addressing then composes dataset-relative
        // names, which is exactly what `registerDataSpace` signed.
        const corpus = await open("", {
          query,
          manifestFiles,
          sql: "allowed",
          wasmUrl: GRAPH_WASM_URL,
        });
        // Also what boots the verb transport, which is what registers the relations
        // every chart and rule in this surface queries by name.
        const schema = await corpus.schema();
        store.setState({
          status: "ready",
          db,
          conn,
          coordinator,
          corpus,
          schema,
          manifestFiles,
        });
      })
      .catch((err) => {
        store.setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [signedUrls, manifestFiles, store]);

  if (status === "error") {
    const error = store.getState().error;
    return (
      <div className="rounded-md border bg-destructive/10 border-destructive/20 px-4 py-3 text-sm text-destructive">
        Failed to initialize discovery: {error}
      </div>
    );
  }

  if (status !== "ready") {
    // Loading state is handled by DiscoveryWorkspace in discovery-view.tsx
    return null;
  }

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

// ── Dynamic import (SSR disabled) ─────────────────────────────────────────

const DiscoveryRoomDynamic = dynamic(() => Promise.resolve(DiscoveryRoom), {
  ssr: false,
});

export function DiscoveryProvider({
  signedUrls,
  manifestFiles,
  children,
}: {
  signedUrls: Record<string, string>;
  manifestFiles: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <DiscoveryRoomDynamic signedUrls={signedUrls} manifestFiles={manifestFiles}>
      {children}
    </DiscoveryRoomDynamic>
  );
}

// ── Hook (used by use-discovery-store.ts) ─────────────────────────────────

export function useDiscoveryStoreApi(): StoreApi<DiscoveryState> {
  const store = useContext(StoreCtx);
  if (!store) throw new Error("useDiscoveryStoreApi must be used within DiscoveryProvider");
  return store;
}
