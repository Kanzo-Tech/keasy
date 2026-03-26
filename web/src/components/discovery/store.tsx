/**
 * Discovery Store — Zustand, no SQLRooms.
 *
 * Initializes DuckDB WASM via Mosaic's wasmConnector,
 * mounts the GraphAr data space as lazy views over remote Parquet,
 * and exposes coordinator + graph instance to all discovery components.
 */

"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { create, type StoreApi, useStore as useZustandStore } from "zustand";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { Graph } from "@cosmos.gl/graph";

import { initMosaic, type MosaicInstance } from "@/lib/mosaic";
import { mountDataSpace } from "@/lib/data-space";
import type { DataManifest } from "@/lib/types";

// ── State ─────────────────────────────────────────────────────────────────

export interface DiscoveryState {
  status: "idle" | "initializing" | "ready" | "error";
  error: string | null;
  db: MosaicInstance["db"] | null;
  conn: MosaicInstance["conn"] | null;
  coordinator: Coordinator | null;
  graph: Graph | null;
  setGraph: (g: Graph | null) => void;
}

function createDiscoveryStore() {
  return create<DiscoveryState>((set) => ({
    status: "idle",
    error: null,
    db: null,
    conn: null,
    coordinator: null,
    graph: null,
    setGraph: (g) => set({ graph: g }),
  }));
}

// ── Context ───────────────────────────────────────────────────────────────

const StoreCtx = createContext<StoreApi<DiscoveryState> | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────

function DiscoveryRoom({
  manifest,
  signedUrls,
  children,
}: {
  manifest: DataManifest;
  signedUrls: Record<string, string>;
  children: ReactNode;
}) {
  const storeRef = useRef<StoreApi<DiscoveryState>>(undefined);
  if (!storeRef.current) storeRef.current = createDiscoveryStore();
  const store = storeRef.current;

  const status = useZustandStore(store, (s) => s.status);

  // Initialize: Mosaic (DuckDB WASM) → mount data space views
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    store.setState({ status: "initializing" });

    initMosaic()
      .then(async ({ coordinator, db, conn }) => {
        await mountDataSpace(conn, manifest, signedUrls);
        store.setState({ status: "ready", db, conn, coordinator });
      })
      .catch((err) => {
        store.setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [manifest, signedUrls, store]);

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
  manifest,
  signedUrls,
  children,
}: {
  manifest: DataManifest;
  signedUrls: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <DiscoveryRoomDynamic manifest={manifest} signedUrls={signedUrls}>
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
