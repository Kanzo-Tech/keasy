/**
 * useGraphCrossfilter — bridges cosmos.gl graph ↔ Mosaic crossfilter.
 *
 * Pattern from Cosmograph 2.0 source: FilteringClient + PointsSelectionClient.
 * The graph is a MosaicClient that:
 *  - Receives widget filters → queries DuckDB for matching _id → selectPointsByIndices (GPU grey-out)
 *  - Publishes graph selections → clausePoints → other widgets re-filter
 *
 * Uses makeClient() from @uwdata/mosaic-core (standard Mosaic client factory).
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { type Selection, makeClient, clausePoints } from "@uwdata/mosaic-core";
import { Query, column } from "@uwdata/mosaic-sql";
import type { Graph } from "@cosmos.gl/graph";
import type { FilterExpr } from "@uwdata/mosaic-sql";

import { useDiscoveryStore } from "./use-discovery-store";
import type { KGGraphData } from "./use-graph-data";

// Stable source identity for the graph's clauses
const GRAPH_SOURCE = { reset: () => {} };

interface GraphCrossfilterResult {
  /** Publish a graph selection to the crossfilter (graph → widgets). */
  publishSelection: (denseIndices: number[]) => void;
  /** Clear the graph's selection from the crossfilter. */
  clearSelection: () => void;
}

/**
 * Connect the cosmos.gl graph to Mosaic crossfiltering.
 *
 * @param graphData - The current graph data (for index↔_id mapping)
 * @param graph - The cosmos.gl Graph instance
 * @param selection - The shared crossfilter Selection (from workspace)
 */
export function useGraphCrossfilter(
  graphData: KGGraphData | null,
  graph: Graph | null,
  selection: Selection,
): GraphCrossfilterResult {
  const coordinator = useDiscoveryStore((s) => s.coordinator);
  const clientRef = useRef<ReturnType<typeof makeClient> | null>(null);

  // Connect a MosaicClient that receives widget filters and highlights the graph
  useEffect(() => {
    if (!coordinator || !graphData || !graph) return;

    const types = [...new Set(graphData.types)];

    const client = makeClient({
      coordinator,
      selection,
      filterStable: true,
      query: (filter: FilterExpr) => {
        // When no active filter, return null (show all)
        if (!filter) return null;
        // Query all vertex types for _id matching the crossfilter predicate
        const subqueries = types.map((t) =>
          Query.from(t).select("_id").where(filter).toString(),
        );
        return subqueries.join(" UNION ALL ");
      },
      queryResult: (data: unknown) => {
        if (!graph || !graphData) return;
        // Extract _id values from the result and map to dense indices
        const rows = data as { _id: number }[];
        if (!rows || !Array.isArray(rows)) {
          graph.unselectPoints();
          return;
        }
        const indices: number[] = [];
        for (const row of rows) {
          const dense = graphData.idToDense.get(row._id);
          if (dense !== undefined) indices.push(dense);
        }
        graph.selectPointsByIndices(indices);
      },
    });

    clientRef.current = client;
    return () => {
      coordinator.disconnect(client);
      clientRef.current = null;
    };
  }, [coordinator, graphData, graph, selection]);

  // Publish graph selection → crossfilter (graph → widgets)
  const publishSelection = useCallback(
    (denseIndices: number[]) => {
      if (!graphData) return;
      if (denseIndices.length === 0) {
        selection.update(
          clausePoints([column("_id")], undefined, { source: GRAPH_SOURCE }),
        );
        return;
      }
      const ids = denseIndices.map((i) => graphData.denseToId[i]);
      selection.update(
        clausePoints(
          [column("_id")],
          ids.map((id) => [id]),
          { source: GRAPH_SOURCE },
        ),
      );
    },
    [graphData, selection],
  );

  // Clear the graph's own clause from the crossfilter
  const clearSelection = useCallback(() => {
    graph?.unselectPoints();
    selection.update(
      clausePoints([column("_id")], undefined, { source: GRAPH_SOURCE }),
    );
  }, [graph, selection]);

  return { publishSelection, clearSelection };
}
