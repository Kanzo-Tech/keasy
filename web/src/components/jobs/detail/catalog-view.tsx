"use client";

import { useState } from "react";
import { Code2, Network } from "lucide-react";
import { CodeView } from "@/components/code-view";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface CatalogViewProps {
  id: string;
  catalog: string;
  dcatFormat: string;
  setDcatFormat: (v: string) => void;
  catalogContent: string | null;
  catalogLoading: boolean;
}

export function CatalogView({
  id,
  catalog,
  dcatFormat,
  setDcatFormat,
  catalogContent,
  catalogLoading,
}: CatalogViewProps) {
  const [viewMode, setViewMode] = useState<"serialized" | "graph">("graph");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 h-7">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={viewMode}
          onValueChange={(v) => { if (v) setViewMode(v as "serialized" | "graph"); }}
        >
          <ToggleGroupItem value="graph" className="h-7 px-2">
            <Network size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="serialized" className="h-7 px-2">
            <Code2 size={14} />
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1" />
        {viewMode === "serialized" && (
          <>
            <Select value={dcatFormat} onValueChange={setDcatFormat}>
              <SelectTrigger className="h-7 w-auto gap-1.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="turtle">Turtle</SelectItem>
                <SelectItem value="jsonld">JSON-LD</SelectItem>
                <SelectItem value="rdfxml">RDF/XML</SelectItem>
                <SelectItem value="ntriples">N-Triples</SelectItem>
                <SelectItem value="nquads">N-Quads</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      {viewMode === "serialized" ? (
        catalogLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : (
          <CodeView
            code={catalogContent ?? catalog}
            lang={dcatFormat === "jsonld" ? "json" : dcatFormat === "rdfxml" ? "xml" : "turtle"}
          />
        )
      ) : (
        <KnowledgeGraph jobId={id} />
      )}
    </div>
  );
}
