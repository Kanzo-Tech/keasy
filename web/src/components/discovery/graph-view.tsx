"use client";

import { useEffect, useRef, useState } from "react";
import { Link, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { api } from "@/lib/api";
import { ForceGraph } from "@/components/discovery/force-graph";
import { useGraphModel } from "@/hooks/use-graph-model";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import type { GraphData, GraphNode, SearchResult } from "@/lib/types";

// ── Static mode (job DCAT catalog graph) ─────────────────────────────────────

interface GraphViewProps {
  jobId: string;
}

export function GraphView({ jobId }: GraphViewProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.graph.job(jobId),
    queryFn: () => api.jobs.graph(jobId),
  });

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

interface InteractiveGraphViewProps {
  jobId?: string;
}

export function InteractiveGraphView({ jobId }: InteractiveGraphViewProps) {
  const {
    data: initial,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: queryKeys.discovery.explorer(jobId),
    queryFn: () => api.discovery.search("", jobId),
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const [selectorMode, setSelectorMode] = useState<"search" | "uri">("search");
  const [query, setQuery] = useState("");
  const [allNodes, setAllNodes] = useState<SearchResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);

  const graph = useGraphModel();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (initial) {
      setAllNodes(initial);
      setResults(initial);
    }
  }, [initial]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setResults(allNodes);
      return;
    }
    if (selectorMode !== "search") return;

    const q = query.toLowerCase();
    const local = allNodes.filter(
      (r) =>
        r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
    setResults(local);

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.discovery.search(query, jobId);
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
  }, [query, allNodes, jobId, selectorMode]);

  async function handleSelectResult(result: SearchResult) {
    setShowResults(false);
    setQuery("");
    try {
      const data = await api.discovery.expand(result.id, jobId);
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
      const data = await api.discovery.expand(node.id, jobId);
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
        <div className="relative mb-4">
          <Skeleton loading className="block w-full">
            <div className="flex items-stretch h-9 rounded-md border border-input">
              <Input disabled placeholder="Search nodes..." className="border-0 shadow-none" />
            </div>
          </Skeleton>
        </div>
        <Skeleton className="flex-1 min-h-[300px] w-full rounded-md" />
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
      {/* Search bar */}
      <div className="relative mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-stretch flex-1 h-9 rounded-md border border-input shadow-xs overflow-hidden focus-within:border-ring focus-within:outline-ring/50 focus-within:outline-[3px]">
            <ToggleGroup
              type="single"
              size="default"
              value={selectorMode}
              onValueChange={(v) => {
                if (!v) return;
                setSelectorMode(v as "search" | "uri");
                setQuery("");
                setShowResults(false);
              }}
            >
              <ToggleGroupItem
                value="search"
                aria-label="Search by label"
                className="h-full !rounded-none border-0"
              >
                <Search size={14} />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="uri"
                aria-label="Enter URI"
                className="h-full !rounded-none border-0 border-r border-input"
              >
                <Link size={14} />
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="relative flex-1">
              {selectorMode === "search" && (
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
              )}
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (selectorMode === "search") {
                    if (results.length > 0) handleSelectResult(results[0]);
                  } else {
                    if (query.trim()) {
                      handleSelectResult({
                        id: query.trim(),
                        label: query.trim(),
                        group: "resource",
                      });
                    }
                  }
                }}
                placeholder={
                  selectorMode === "search"
                    ? "Search nodes by label..."
                    : "Enter a full URI and press Enter..."
                }
                className={`${selectorMode === "search" ? "pl-9" : "pl-3"} h-full border-0 shadow-none rounded-l-none focus-visible:outline-none`}
                onFocus={selectorMode === "search" ? () => setShowResults(true) : undefined}
                onBlur={selectorMode === "search" ? () => setTimeout(() => setShowResults(false), 200) : undefined}
              />
            </div>
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
        {selectorMode === "search" && showResults && results.length > 0 && (
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

        {selectorMode === "search" && showResults && results.length === 0 && !searching && (
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
              : selectorMode === "uri"
                ? "Enter a URI above to start exploring."
                : "Search for a node to start exploring."}
          </p>
        </div>
      )}
    </div>
  );
}
