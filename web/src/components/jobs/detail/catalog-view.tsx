"use client";

import { useState } from "react";
import { Code2, Network } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { CodeView } from "@/components/discovery/code-view";
import { GraphView } from "@/components/discovery/graph-view";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type DcatFormat = "turtle" | "jsonld" | "rdfxml" | "ntriples" | "nquads";

interface CatalogViewProps {
  id: string;
  /** The default turtle catalog string from the job. */
  catalog: string;
}

export function CatalogView({ id, catalog }: CatalogViewProps) {
  const [viewMode, setViewMode] = useState<"serialized" | "graph">("graph");
  const [dcatFormat, setDcatFormat] = useState<DcatFormat>("turtle");

  const { data: fetchedCatalog, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.jobs.catalog(id, dcatFormat),
    queryFn: () => api.jobs.catalog(id, dcatFormat),
    enabled: dcatFormat !== "turtle",
  });
  const catalogContent = dcatFormat === "turtle" ? catalog : (fetchedCatalog ?? null);

  const showCatalogSkeleton = useDelayedLoading(catalogLoading);

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
          <Select value={dcatFormat} onValueChange={(v) => setDcatFormat(v as DcatFormat)}>
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
        )}
      </div>
      {viewMode === "serialized" ? (
        catalogLoading ? (
          showCatalogSkeleton ? (
            <div className="space-y-2 p-3">
              <Skeleton loading className="block w-full"><p className="text-sm font-mono">@prefix dcat: placeholder .</p></Skeleton>
              <Skeleton loading className="block w-3/4"><p className="text-sm font-mono">@prefix dct: placeholder .</p></Skeleton>
              <Skeleton loading className="block w-5/6"><p className="text-sm font-mono">@prefix xsd: placeholder .</p></Skeleton>
            </div>
          ) : null
        ) : (
          <CodeView
            code={catalogContent ?? catalog}
            lang={dcatFormat === "jsonld" ? "json" : dcatFormat === "rdfxml" ? "xml" : "turtle"}
          />
        )
      ) : (
        <GraphView jobId={id} />
      )}
    </div>
  );
}
