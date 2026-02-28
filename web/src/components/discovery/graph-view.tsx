"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchJobGraph,
  fetchAdminGraph,
  searchGraphNodes,
  expandGraphNode,
  loadJobDiscovery,
} from "@/lib/api";
import { ForceGraph } from "@/components/discovery/force-graph";
import { useGraphModel } from "@/hooks/use-graph-model";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import type { GraphData, GraphNode, SearchResult } from "@/lib/types";

type GraphSource =
  | { type: "job"; jobId: string }
  | { type: "admin"; orgId?: string }
  | { type: "discovery"; jobId: string };

interface GraphViewProps {
  source: GraphSource;
  interactive?: boolean;
}

export function GraphView({ source, interactive }: GraphViewProps) {
  const isInteractive = interactive ?? source.type === "discovery";

  if (isInteractive) {
    return <InteractiveGraphView source={source} />;
  }
  return <StaticGraphView source={source} />;
}

// ── Static mode (job catalog + admin unified graph) ──────────────────────────

function StaticGraphView({ source }: { source: GraphSource }) {
  const fetcher = (): Promise<GraphData> => {
    if (source.type === "job") return fetchJobGraph(source.jobId);
    if (source.type === "admin") return fetchAdminGraph(source.orgId);
    return fetchJobGraph((source as { type: "discovery"; jobId: string }).jobId);
  };

  const swrKey =
    source.type === "job"
      ? `graph-${source.jobId}`
      : source.type === "admin"
        ? source.orgId
          ? `graph-org-${source.orgId}`
          : "graph-unified"
        : `graph-${(source as { type: "discovery"; jobId: string }).jobId}`;

  const { data, isLoading } = useSWR(swrKey, fetcher);

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

// ── Interactive mode (discovery explorer) ────────────────────────────────────

function InteractiveGraphView({ source }: { source: GraphSource }) {
  const jobId =
    source.type === "discovery"
      ? source.jobId
      : source.type === "job"
        ? source.jobId
        : "";

  const {
    data: initial,
    isLoading,
    error: loadError,
  } = useSWR(`explorer-${jobId}`, async () => {
    const discovery = await loadJobDiscovery(jobId);
    const nodes = await searchGraphNodes("", jobId);
    return { discovery, nodes };
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const tripleCount = initial?.discovery.triple_count ?? 0;
  const subjectCount = initial?.discovery.subject_count ?? 0;

  const [query, setQuery] = useState("");
  const [allNodes, setAllNodes] = useState<SearchResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);

  const graph = useGraphModel();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (initial?.nodes) {
      setAllNodes(initial.nodes);
      setResults(initial.nodes);
    }
  }, [initial]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setResults(allNodes);
      return;
    }
    const q = query.toLowerCase();
    const local = allNodes.filter(
      (r) =>
        r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
    setResults(local);

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchGraphNodes(query, jobId);
        const ids = new Set(local.map((n) => n.id));
        const extra = r.filter((n) => !ids.has(n.id));
        if (extra.length > 0) {
          setResults((prev) => [...prev, ...extra]);
        }
      } catch {
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, allNodes, jobId]);

  async function handleSelectResult(result: SearchResult) {
    setShowResults(false);
    setQuery("");
    try {
      const data = await expandGraphNode(result.id, jobId);
      if (data.nodes.length === 0 && data.links.length === 0) {
        graph.merge({
          nodes: [{ id: result.id, label: result.label, group: result.group }],
          links: [],
        });
      } else {
        graph.merge(data);
      }
      if (
        data.links.length > 0 ||
        (data.nodes.length === 0 && data.links.length === 0)
      ) {
        graph.markExpanded(result);
      }
    } catch {
      toast.error("Failed to expand node");
    }
  }

  async function handleNodeClick(node: GraphNode) {
    setSelectedNode(node);
    if (node.group === "literal") return;
    try {
      const data = await expandGraphNode(node.id, jobId);
      graph.merge(data);
      if (data.links.length > 0) {
        graph.markExpanded({
          id: node.id,
          label: node.label,
          group: node.group,
        });
      }
    } catch {
      toast.error("Failed to expand node");
    }
  }

  function handleClear() {
    graph.clear();
    setSelectedNode(null);
    setQuery("");
    setResults(allNodes);
  }

  if (isLoading) {
    return showSkeleton ? (
      <div className="flex flex-col flex-1 min-h-0">
        <Skeleton className="h-4 w-48 mb-3" />
        <Skeleton className="h-9 w-full mb-4" />
        <Skeleton className="flex-1 min-h-[300px] rounded-md" />
      </div>
    ) : null;
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {loadError?.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Stats */}
      <p className="text-xs text-muted-foreground mb-3">
        {tripleCount.toLocaleString()} triples &middot;{" "}
        {subjectCount.toLocaleString()} subjects
      </p>

      {/* Search bar */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes by label or IRI..."
              className="pl-9 h-9 focus-visible:ring-1"
              onFocus={() => setShowResults(true)}
              onBlur={() => {
                setTimeout(() => setShowResults(false), 200);
              }}
            />
          </div>
          {!graph.isEmpty && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              onClick={handleClear}
            >
              <X size={14} />
              Clear
            </Button>
          )}
        </div>

        {/* Search results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute z-10 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectResult(r);
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      r.group === "literal"
                        ? "#64748b"
                        : "var(--primary)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {r.id}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {showResults && results.length === 0 && !searching && (
          <div className="absolute z-10 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
            <p className="text-sm text-muted-foreground">
              {allNodes.length === 0
                ? "No nodes found in the output data."
                : "No matching nodes found."}
            </p>
          </div>
        )}
      </div>

      {/* Explored nodes chips */}
      {graph.expandedNodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {graph.expandedNodes.map((n) => (
            <Badge
              key={n.id}
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-destructive/20 transition-colors"
              onClick={() => {
                graph.removeNode(n.id);
                if (selectedNode?.id === n.id) setSelectedNode(null);
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    n.group === "literal" ? "#64748b" : "var(--primary)",
                }}
              />
              {n.label}
              <X size={12} className="ml-0.5 opacity-50 hover:opacity-100" />
            </Badge>
          ))}
        </div>
      )}

      {/* Graph area */}
      {!graph.isEmpty ? (
        <ForceGraph
          data={graph.graphData}
          selectedId={selectedNode?.id}
          onNodeClick={handleNodeClick}
        />
      ) : (
        <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden bg-background flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {allNodes.length === 0
              ? "No RDF nodes found in the output data."
              : "Select a node from the dropdown to start exploring."}
          </p>
        </div>
      )}
    </div>
  );
}
