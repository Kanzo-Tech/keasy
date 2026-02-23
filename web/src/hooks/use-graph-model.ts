import { useCallback, useMemo, useState } from "react";
import type { GraphNode, GraphLink, SearchResult } from "@/lib/types";

interface GraphModel {
  nodes: Map<string, GraphNode>;
  links: GraphLink[];
  expanded: Map<string, SearchResult>;
}

function emptyModel(): GraphModel {
  return { nodes: new Map(), links: [], expanded: new Map() };
}

function linkKey(l: GraphLink): string {
  return `${l.source}-${l.target}-${l.label}`;
}

export function useGraphModel() {
  const [model, setModel] = useState<GraphModel>(emptyModel);

  const merge = useCallback(
    (data: { nodes: GraphNode[]; links: GraphLink[] }) => {
      setModel((prev) => {
        const nodes = new Map(prev.nodes);
        for (const n of data.nodes) {
          if (!nodes.has(n.id)) nodes.set(n.id, n);
        }

        const existing = new Set(prev.links.map(linkKey));
        const newLinks = data.links.filter((l) => !existing.has(linkKey(l)));
        const links = newLinks.length > 0 ? [...prev.links, ...newLinks] : prev.links;

        return { nodes, links, expanded: prev.expanded };
      });
    },
    [],
  );

  const markExpanded = useCallback((result: SearchResult) => {
    setModel((prev) => {
      if (prev.expanded.has(result.id)) return prev;
      const expanded = new Map(prev.expanded);
      expanded.set(result.id, result);
      return { ...prev, expanded };
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setModel((prev) => {
      const links = prev.links.filter(
        (l) => l.source !== id && l.target !== id,
      );

      const referenced = new Set<string>();
      for (const l of links) {
        referenced.add(l.source);
        referenced.add(l.target);
      }

      const expanded = new Map(prev.expanded);
      expanded.delete(id);

      const nodes = new Map<string, GraphNode>();
      for (const [nid, node] of prev.nodes) {
        if (nid !== id && (referenced.has(nid) || expanded.has(nid))) {
          nodes.set(nid, node);
        }
      }

      return { nodes, links, expanded };
    });
  }, []);

  const clear = useCallback(() => {
    setModel(emptyModel);
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: [...model.nodes.values()],
      links: model.links.map((l) => ({ ...l })),
    }),
    [model],
  );

  const expandedNodes = useMemo(
    () => [...model.expanded.values()],
    [model],
  );

  return {
    graphData,
    expandedNodes,
    nodeCount: model.nodes.size,
    linkCount: model.links.length,
    isEmpty: model.nodes.size === 0,
    merge,
    markExpanded,
    removeNode,
    clear,
  } as const;
}
