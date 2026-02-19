"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchGraphNodes, expandGraphNode, loadJobDiscovery } from "@/lib/api";
import { ForceGraph } from "@/components/force-graph";
import { useGraphModel } from "@/hooks/use-graph-model";
import type { GraphNode, SearchResult } from "@/lib/types";

interface DiscoveryExplorerProps {
  jobId: string;
}

export function DiscoveryExplorer({ jobId }: DiscoveryExplorerProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tripleCount, setTripleCount] = useState(0);

  const [query, setQuery] = useState("");
  const [allNodes, setAllNodes] = useState<SearchResult[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);

  const graph = useGraphModel();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Load output data into GraphStore on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadJobDiscovery(jobId)
      .then((res) => {
        if (cancelled) return;
        setTripleCount(res.triple_count);
        // Now load all available nodes
        return searchGraphNodes("", jobId);
      })
      .then((r) => {
        if (cancelled || !r) return;
        setAllNodes(r);
        setResults(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [jobId]);

  // Debounced search
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
        // Local results are enough
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
      graph.merge(data);
      const hasOutgoing = data.links.some((l) => l.source === result.id);
      if (hasOutgoing) {
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
      const hasOutgoing = data.links.some((l) => l.source === node.id);
      if (hasOutgoing) {
        graph.markExpanded({ id: node.id, label: node.label, group: node.group });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        Loading output data...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats */}
      <p className="text-xs text-muted-foreground mb-3">
        {tripleCount} triples loaded &middot; {allNodes.length} distinct subjects
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
              className="pl-9 h-9"
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
                onClick={() => handleSelectResult(r)}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: r.group === "literal" ? "#64748b" : "var(--primary)",
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
          legendExtra={<>{graph.nodeCount} nodes, {graph.linkCount} edges</>}
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
