"use client";

import useSWR from "swr";
import { fetchJobGraph, fetchUnifiedGraph } from "@/lib/api";
import { ForceGraph } from "@/components/discovery/force-graph";
import type { GraphData } from "@/lib/types";

export function KnowledgeGraph({ jobId }: { jobId?: string }) {
  const fetcher = (): Promise<GraphData> =>
    jobId ? fetchJobGraph(jobId) : fetchUnifiedGraph();

  const { data, isLoading } = useSWR(
    jobId ? `graph-${jobId}` : "graph-unified",
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground p-4">Loading graph...</div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No graph data available.
      </div>
    );
  }

  return <ForceGraph data={data} />;
}
