"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MetaItem } from "@/components/meta-item";
import { PipelineSection } from "@/components/pipeline-section";
import { Section } from "@/components/section";
import { cn } from "@/lib/utils";
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
  onDcatToggle: (enabled: boolean) => void;
  orgConfigured: boolean;
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
  onDcatToggle,
  orgConfigured,
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
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Job info */}
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetaItem label="Name" value={jobName || "Unnamed"} />
        <MetaItem label="Mode" value={mode} capitalize />
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

      {/* DCAT toggle card — always visible, disabled when org not configured */}
      <Section label="Options">
        <div
          className={cn(
            "flex items-center justify-between rounded-lg border p-3 transition-colors",
            !orgConfigured
              ? "border-border opacity-50"
              : dcatEnabled
                ? "border-primary/50 bg-primary/5"
                : "border-border"
          )}
        >
          <div className="space-y-0.5">
            <Label htmlFor="dcat-toggle" className="text-sm font-medium">
              DCAT-AP Catalog
            </Label>
            <p className="text-xs text-muted-foreground">
              {orgConfigured
                ? "Generate a DCAT-AP metadata record for the published datasets"
                : "Requires organization settings to be configured"}
            </p>
          </div>
          <Switch
            id="dcat-toggle"
            checked={dcatEnabled && orgConfigured}
            onCheckedChange={(checked) => onDcatToggle(checked)}
            disabled={!orgConfigured}
          />
        </div>
      </Section>

      <div className="flex items-center justify-between pt-2">
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
      </div>
    </div>
  );
}
