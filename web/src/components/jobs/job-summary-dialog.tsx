"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetaItem } from "@/components/shared/meta-item";
import { PageShell } from "@/components/layout/page-shell";
import { PipelineSection } from "@/components/pipeline-flow/pipeline-section";
import { reverseMapUrl, reverseMapPipeline } from "@/lib/formatters";
import type { RunMode, ValidationResult, Connection } from "@/lib/types";

interface JobSummaryPanelProps {
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  jobName: string;
  mode: RunMode;
  validation: ValidationResult;
  dcatEnabled: boolean;
  connections?: Connection[];
}

const FORMAT_LABELS: Record<string, string> = {
  ".ttl": "Turtle",
  ".csv": "CSV",
  ".json": "JSON",
  ".jsonld": "JSON-LD",
  ".xml": "XML",
  ".nq": "N-Quads",
  ".nt": "N-Triples",
  ".rdf": "RDF/XML",
  ".parquet": "Parquet",
};

function inferFormat(destination: string): string | null {
  const lower = destination.toLowerCase();
  for (const [ext, label] of Object.entries(FORMAT_LABELS)) {
    if (lower.endsWith(ext)) return label;
  }
  return null;
}

export function JobSummaryPanel({
  onConfirm,
  onCancel,
  submitting,
  jobName,
  mode,
  validation,
  dcatEnabled,
  connections = [],
}: JobSummaryPanelProps) {
  const rawDests = [
    ...new Set(
      validation.pipeline.outputs
        .map((o) => o.destination)
        .filter((d): d is string => d != null)
    ),
  ];
  const destinations = rawDests.map((d) => reverseMapUrl(d, connections));
  const formats = [
    ...new Set(
      rawDests
        .map((d) => inferFormat(d))
        .filter((f): f is string => f !== null)
    ),
  ];
  const mappedPipeline = reverseMapPipeline(validation.pipeline, connections);

  return (
    <PageShell>
      <PageShell.Content className="gap-5">
        {/* Job info */}
        <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="Name" value={jobName || "Unnamed"} />
          <MetaItem label="Mode" value={mode} capitalize />
          <MetaItem label="DCAT Catalog" value={dcatEnabled ? "Enabled" : "Disabled"} />
          {destinations.length > 0 && (
            <MetaItem label="Destination" value={destinations.join(", ")} mono />
          )}
          {formats.length > 0 && (
            <MetaItem label="Format" value={formats.join(", ")} />
          )}
        </div>

        {/* Pipeline */}
        {(mappedPipeline.inputs.length > 0 || mappedPipeline.outputs.length > 0) ? (
          <PipelineSection pipeline={mappedPipeline} className="flex-1 min-h-0 flex flex-col" />
        ) : (
          <p className="text-sm text-muted-foreground">
            No data connections or outputs detected in the script.
          </p>
        )}
      </PageShell.Content>

      <PageShell.Footer>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting ? "Creating..." : "Confirm"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
