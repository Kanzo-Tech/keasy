"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useDiscoveryStoreApi, type DiscoveryState } from "./store";
import type { Coordinator } from "@uwdata/mosaic-core";

export function useDiscoveryStore<T>(selector: (s: DiscoveryState) => T): T {
  const store = useDiscoveryStoreApi();
  return useStore(store, selector);
}

export function useCoordinator(): Coordinator | null {
  return useDiscoveryStore((s) => s.coordinator);
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
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const versionRef = useRef(0);

  const { query, enabled = true } = options;

  useEffect(() => {
    if (!coordinator || !enabled || !query) {
      setData(null);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);

    coordinator
      .query(query, { type: "json" })
      .then((result) => {
        if (version !== versionRef.current) return;
        setData((result as T[]) ?? []);
      })
      .catch(() => {
        if (version !== versionRef.current) return;
        setData(null);
      })
      .finally(() => {
        if (version !== versionRef.current) return;
        setLoading(false);
      });
  }, [coordinator, query, enabled]);

  return { data, loading };
}
