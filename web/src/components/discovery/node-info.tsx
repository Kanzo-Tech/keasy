"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { useGraphClient } from "./use-discovery-store";
import { GROUP_CSS_COLORS } from "@fossil-lang/viewer";
import type { GraphSchema } from "@/lib/graph-schema";

interface Props {
  schema: GraphSchema;
  selectedVertex: { id: string; type: string; label: string } | null;
}

export function NodeInfo({ schema, selectedVertex }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const graphClient = useGraphClient();

  // Single-vertex lookup via the get_vertex verb (reserved columns already
  // filtered server-side) — no hand-built SQL.
  const [vertexProps, setVertexProps] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!graphClient || !selectedVertex) {
      setVertexProps(null);
      return;
    }
    let cancelled = false;
    graphClient
      .getVertex({ vertex_type: selectedVertex.type, subject: selectedVertex.id })
      .then((r) => {
        if (!cancelled) setVertexProps((r.vertex as Record<string, unknown> | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setVertexProps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [graphClient, selectedVertex]);

  const properties = useMemo(() => {
    if (!vertexProps || !selectedVertex) return [];
    const fields = schema.fieldsOf(selectedVertex.type);
    return Object.entries(vertexProps)
      .filter(([, val]) => val != null && val !== "")
      .map(([key, val]) => {
        const field = fields.find((f) => f.name === key);
        return { predicate: key, value: String(val), role: field?.role };
      });
  }, [vertexProps, selectedVertex, schema]);

  // Type color
  const typeIndex = selectedVertex ? schema.types.findIndex((t) => t.name === selectedVertex.type) : -1;
  const typeColor = typeIndex >= 0 ? GROUP_CSS_COLORS[typeIndex % GROUP_CSS_COLORS.length] : undefined;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Info" />

      {/* Search */}
      <div className="shrink-0 border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Search size={12} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search entities..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {selectedVertex ? (
            <div className="space-y-2">
              {/* Node header */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  {typeColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: typeColor }} />}
                  <span className="text-sm font-medium truncate">{selectedVertex.label}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{selectedVertex.type}</p>
              </div>

              {/* Properties table */}
              {properties.length > 0 ? (
                <div className="border rounded-sm overflow-hidden">
                  {properties.map((p, i) => (
                    <div key={i} className="flex gap-2 px-2 py-1 text-xs even:bg-muted/30">
                      <span className="w-24 shrink-0 text-muted-foreground truncate">{p.predicate}</span>
                      <span className="flex-1 font-mono text-[11px] break-all">{p.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-2">Loading...</p>
              )}

              {/* URI */}
              <p className="text-[9px] text-muted-foreground/60 break-all font-mono">{selectedVertex.id}</p>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-xs text-muted-foreground">Select a node to view details</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Click any node on the graph</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
