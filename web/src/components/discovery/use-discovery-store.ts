"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useDiscoveryStoreApi, type DiscoveryState } from "./store";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { GraphClient } from "@fossil-lang/graph";

export function useDiscoveryStore<T>(selector: (s: DiscoveryState) => T): T {
  const store = useDiscoveryStoreApi();
  return useStore(store, selector);
}

export function useCoordinator(): Coordinator | null {
  return useDiscoveryStore((s) => s.coordinator);
}

/** The fossil-graph verb client — the single source for discrete reads. */
export function useGraphClient(): GraphClient | null {
  return useDiscoveryStore((s) => s.graphClient);
}

// ── useCoordinatorQuery ──────────────────────────────────────────────────

interface QueryResult<T> {
  data: T | null;
  loading: boolean;
}

export function useCoordinatorQuery<T>(options: {
  query: string;
  enabled?: boolean;
}): QueryResult<T[]> {
  const coordinator = useCoordinator();
  const { query, enabled = true } = options;
  const active = Boolean(coordinator && enabled && query);

  // Tagged with the coordinator and query it answers, so a change of either
  // reads as "loading" without an effect having to blank the previous result.
  const [result, setResult] = useState<{
    coordinator: Coordinator;
    query: string;
    data: T[] | null;
  } | null>(null);
  const versionRef = useRef(0);

  useEffect(() => {
    if (!coordinator || !enabled || !query) return;

    const version = ++versionRef.current;

    coordinator
      .query(query, { type: "json" })
      .then((rows) => {
        if (version !== versionRef.current) return;
        setResult({ coordinator, query, data: (rows as T[]) ?? [] });
      })
      .catch(() => {
        if (version !== versionRef.current) return;
        setResult({ coordinator, query, data: null });
      });
  }, [coordinator, query, enabled]);

  const fresh =
    active &&
    result !== null &&
    result.coordinator === coordinator &&
    result.query === query;

  return { data: fresh ? result.data : null, loading: active && !fresh };
}
