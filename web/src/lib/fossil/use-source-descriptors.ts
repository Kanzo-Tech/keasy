"use client";

/**
 * useSourceDescriptors — produce InferredDescriptors for the job editor's
 * source bindings, driving source-field completion (CONNECTION-SHAPE-MODEL
 * step 2).
 *
 * The introspection LOGIC lives in fossil (@fossil-lang/introspect, re-exported
 * from @fossil-lang/editor): `extractSourceRefs` scrapes `name := io.csv("@c/p")`
 * bindings and `buildDescriptor` maps DuckDB-ish column types through the
 * canonical fossil primitive table. keasy supplies only the DATA PLANE — and
 * does so server-side via the EXISTING `GET /v1/connections/{id}/schema`
 * endpoint (which downloads the file with org credentials + infers its columns).
 * That choice (D-1 in EDITOR-SCHEMA-AWARE-PLAN) avoids browser CORS on signed
 * cloud URLs + duckdb-wasm httpfs, and keeps secrets server-side — matching
 * keasy's "backend mandatory for secrets" posture. The endpoint's type
 * vocabulary ("string"/"bool"/"int"/"float"/"date") flows straight through
 * fossil's `duckdbTypeToFossilPrimitive`, so no keasy-side type logic is added.
 *
 * Best-effort: refs whose connection is unknown, non-`@`, or whose schema fetch
 * fails (e.g. non-csv) are skipped — the editor degrades to no field completion
 * for that source rather than hard-failing.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  buildDescriptor,
  extractSourceRefs,
  type DescribeRow,
  type InferredDescriptor,
} from "@fossil-lang/editor";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Connection } from "@/lib/types";

/** Debounce a fast-changing value (editor keystrokes) to one settled value. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

interface ResolvedRef {
  sourceName: string;
  connId: string;
  path: string;
}

/** Parse `@connName/path` → connName + path (the keasy source-ref form). */
function parseConnRef(url: string): { connName: string; path: string } | null {
  const m = /^@([^/]+)\/(.+)$/.exec(url);
  return m ? { connName: m[1], path: m[2] } : null;
}

export function useSourceDescriptors(
  script: string,
  connections: Connection[],
): InferredDescriptor[] {
  const debouncedScript = useDebouncedValue(script, 400);

  // data-connection name → id (only `data` connections are sources).
  const idByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections) {
      if (c.kind === "data") m.set(c.name, c.id);
    }
    return m;
  }, [connections]);

  // Source bindings resolved to a fetchable (connId, path).
  const resolved = useMemo<ResolvedRef[]>(() => {
    const out: ResolvedRef[] = [];
    for (const ref of extractSourceRefs(debouncedScript)) {
      const parsed = parseConnRef(ref.url);
      if (!parsed) continue;
      const connId = idByName.get(parsed.connName);
      if (!connId) continue;
      out.push({ sourceName: ref.sourceName, connId, path: parsed.path });
    }
    return out;
  }, [debouncedScript, idByName]);

  // One cached schema fetch per (connId, path). React Query dedups + caches.
  const queries = useQueries({
    queries: resolved.map((r) => ({
      queryKey: queryKeys.connections.schema(r.connId, r.path),
      queryFn: () => api.connections.schema(r.connId, r.path),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });

  // Content signature of the resolved descriptors (a primitive), so the memo
  // below returns a referentially-stable array until the CONTENT changes —
  // <FossilEditor descriptors={…}/>'s effect then only re-registers on real
  // changes, not on every keystroke/render. (React Query keeps `data` stable
  // across renders when unchanged, so the signature is stable too.)
  const sig = resolved
    .map((r, i) => {
      const cols = queries[i]?.data?.columns;
      return cols
        ? `${r.sourceName}=${cols.map((c) => `${c.name}:${c.data_type}`).join(",")}`
        : "";
    })
    .join("|");

  return useMemo<InferredDescriptor[]>(() => {
    const out: InferredDescriptor[] = [];
    resolved.forEach((r, i) => {
      const cols = queries[i]?.data?.columns;
      if (!cols) return;
      const rows: DescribeRow[] = cols.map((c) => ({
        column_name: c.name,
        column_type: c.data_type,
      }));
      out.push(buildDescriptor(r.sourceName, rows));
    });
    return out;
    // `sig` is the content key for (resolved + query data); recompute only when
    // it changes. resolved/queries are intentionally not listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
