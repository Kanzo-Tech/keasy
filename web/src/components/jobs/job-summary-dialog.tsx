"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetaItem } from "@/components/shared/meta-item";
import { PageShell } from "@/components/layout/page-shell";
import type { RunMode } from "@/lib/types";

interface JobSummaryPanelProps {
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
  jobName: string;
  mode: RunMode;
  dcatEnabled: boolean;
}

export function JobSummaryPanel({
  onConfirm,
  onCancel,
  submitting,
  jobName,
  mode,
  dcatEnabled,
}: JobSummaryPanelProps) {
  return (
    <PageShell>
      <PageShell.Content className="gap-5">
        {/* Job config the user set. The output graph (types, columns,
            destinations) is shown from the run manifest once the job runs —
            the editor is the canonical view of the program itself. */}
        <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="Name" value={jobName || "Unnamed"} />
          <MetaItem label="Mode" value={mode} capitalize />
          <MetaItem label="DCAT Catalog" value={dcatEnabled ? "Enabled" : "Disabled"} />
        </div>
        <p className="text-sm text-muted-foreground">
          The output graph appears here once the job runs.
        </p>
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
