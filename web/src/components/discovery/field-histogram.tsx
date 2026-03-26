/**
 * FieldHistogram — vgplot mini histogram with Mosaic crossfilter.
 *
 * Dual-layer pattern (from deckgl-mosaic example):
 *  - Background: all data (dimmed) — shows full distribution
 *  - Foreground: filtered data — shows current crossfilter subset
 *
 * Brush interaction publishes clauseInterval/toggleX to the shared Selection.
 * DuckDB only transfers the single needed column via HTTP Range requests.
 */

"use client";

import { useEffect, useRef } from "react";
import * as vg from "@uwdata/vgplot";
import type { Selection } from "@uwdata/mosaic-core";
import { NUMERIC_DUCKDB_TYPES, TEMPORAL_DUCKDB_TYPES } from "@/lib/graph-schema";

interface Props {
  tableName: string;
  fieldName: string;
  fieldType: string;
  selection: Selection;
}

/** Check if a DuckDB type supports binning (numeric or temporal). */
function isBinnable(type: string): boolean {
  const upper = type.toUpperCase().replace(/\(.*\)/, "").trim();
  return NUMERIC_DUCKDB_TYPES.has(upper) || TEMPORAL_DUCKDB_TYPES.has(upper);
}

export function FieldHistogram({ tableName, fieldName, fieldType, selection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const binnable = isBinnable(fieldType);

    let plot: HTMLElement;
    if (binnable) {
      // Numeric/temporal: vertical bars (rectY) with brush selection
      plot = vg.plot(
        vg.rectY(vg.from(tableName), {
          x: vg.bin(fieldName), y: vg.count(),
          fill: "#94a3b8", opacity: 0.3,
        }),
        vg.rectY(vg.from(tableName, { filterBy: selection }), {
          x: vg.bin(fieldName), y: vg.count(),
          fill: "steelblue",
        }),
        vg.intervalX({ as: selection }),
        vg.height(100),
        vg.marginLeft(30), vg.marginRight(4), vg.marginTop(4), vg.marginBottom(20),
        vg.yAxis(null),
        vg.xAxis("bottom"),
      );
    } else {
      // Categorical: vertical bars (barY) with toggle selection
      plot = vg.plot(
        vg.barY(vg.from(tableName), {
          x: fieldName, y: vg.count(),
          fill: "#94a3b8", opacity: 0.3,
          sort: { x: "-y" }, limit: 8,
        }),
        vg.barY(vg.from(tableName, { filterBy: selection }), {
          x: fieldName, y: vg.count(),
          fill: "steelblue",
          sort: { x: "-y" }, limit: 8,
        }),
        vg.toggleX({ as: selection }),
        vg.height(100),
        vg.marginLeft(30), vg.marginRight(4), vg.marginTop(4), vg.marginBottom(24),
        vg.yAxis(null),
        vg.xAxis("bottom"),
        vg.xTickRotate(45),
      );
    }

    containerRef.current.replaceChildren(plot);

    return () => {
      containerRef.current?.replaceChildren();
    };
  // selection is a stable ref — vgplot handles crossfilter updates internally via filterBy
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName, fieldName, fieldType]);

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground font-medium truncate px-1">{fieldName}</p>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
