/**
 * Discovery Store — Zustand, no SQLRooms.
 *
 * Everything about opening the corpus lives in `openJobCorpus`: fossil
 * enumerates what is addressable, keasy signs that list and lends it to DuckDB's
 * file registry, and the corpus is reopened with the engine. This component is
 * what holds the result for the surface — the coordinator the charts bind to,
 * and the schema the verbs registered.
 */

"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { create, type StoreApi, useStore as useZustandStore } from "zustand";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { SchemaResult, SqlCorpus } from "@fossil-lang/corpus";

import type { MosaicInstance } from "@/lib/mosaic";
import { openJobCorpus } from "@/lib/fossil/open-job-corpus";

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
  /** The manifests fossil named, kept so a canvas can address a type without refetching. */
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

function DiscoveryRoom({ jobId, children }: { jobId: string; children: ReactNode }) {
  const [store] = useState(createDiscoveryStore);

  const status = useZustandStore(store, (s) => s.status);

  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    store.setState({ status: "initializing" });

    openJobCorpus(jobId)
      .then(async ({ mosaic, corpus, manifestFiles }) => {
        // Also what boots the verb transport, which is what registers the relations
        // every chart and rule in this surface queries by name.
        const schema = await corpus.schema();
        store.setState({
          status: "ready",
          db: mosaic.db,
          conn: mosaic.conn,
          coordinator: mosaic.coordinator,
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
  }, [jobId, store]);

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

export function DiscoveryProvider({ jobId, children }: { jobId: string; children: ReactNode }) {
  return <DiscoveryRoomDynamic jobId={jobId}>{children}</DiscoveryRoomDynamic>;
}

// ── Hook (used by use-discovery-store.ts) ─────────────────────────────────

export function useDiscoveryStoreApi(): StoreApi<DiscoveryState> {
  const store = useContext(StoreCtx);
  if (!store) throw new Error("useDiscoveryStoreApi must be used within DiscoveryProvider");
  return store;
}
