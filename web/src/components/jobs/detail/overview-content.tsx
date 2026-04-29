import { AlertCircle } from "lucide-react";
import { MetaGrid, type MetaGridItem } from "@/components/shared/meta-grid";
import { PipelineSection } from "@/components/pipeline-flow/pipeline-section";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getErrorInfo } from "@/lib/error-codes";
import { formatDuration } from "@/lib/formatters";
import type { Job, JobError } from "@/lib/types";
import Link from "next/link";

interface OverviewContentProps {
  job: Job;
  dests: string[];
  hasPipeline: boolean;
}

function JobErrorBlock({ error }: { error: JobError }) {
  const info = getErrorInfo(error.code);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-4 mt-0.5 shrink-0" />
        <span className="text-sm">{info.message}</span>
      </div>
      {info.link && (
        <Button variant="outline" size="sm" className="w-fit" asChild>
          <Link href={info.link.href}>{info.link.label}</Link>
        </Button>
      )}
      {error.detail && (
        <Collapsible>
          <CollapsibleTrigger className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100">
            Technical details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-70">{error.detail}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function OverviewContent({
  job,
  dests,
  hasPipeline,
}: OverviewContentProps) {
  const items: MetaGridItem[] = [
    { label: "ID", value: job.id.slice(0, 12), mono: true },
    { label: "Created", value: new Date(job.created_at).toLocaleString() },
  ];
  if (job.started_at) {
    items.push({
      label: "Run",
      value: job.completed_at
        ? `${new Date(job.started_at).toLocaleTimeString()} (${formatDuration(job.started_at, job.completed_at)})`
        : `${new Date(job.started_at).toLocaleTimeString()} (running)`,
    });
  }
  if (dests.length > 0) {
    items.push({ label: "Destination", value: dests.join(", "), mono: true });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MetaGrid items={items} className="mb-4 lg:grid-cols-4" />

      {hasPipeline && job.pipeline && (
        <PipelineSection pipeline={job.pipeline} className="flex-1 min-h-0 flex flex-col" />
      )}

      {job.error && <JobErrorBlock error={job.error} />}
    </div>
  );
}
