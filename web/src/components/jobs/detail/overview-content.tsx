import { AlertCircle } from "lucide-react";
import { MetaItem } from "@/components/shared/meta-item";
import { PipelineSection } from "@/components/pipeline-flow/pipeline-section";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getErrorInfo } from "@/lib/error-codes";
import { formatDuration } from "@/lib/formatters";
import type { Job, JobError, JobEvent } from "@/lib/types";
import Link from "next/link";

const PHASES = ["Queued", "Compiling", "Executing", "Finalizing", "Complete"];

interface OverviewContentProps {
  job: Job;
  dests: string[];
  hasPipeline: boolean;
  progress: JobEvent | null;
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
  progress,
}: OverviewContentProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <MetaItem label="ID" value={job.id.slice(0, 12)} mono />
        <MetaItem label="Created" value={new Date(job.created_at).toLocaleString()} />
        {job.started_at && (
          <MetaItem
            label="Run"
            value={
              job.completed_at
                ? `${new Date(job.started_at).toLocaleTimeString()} (${formatDuration(job.started_at, job.completed_at)})`
                : `${new Date(job.started_at).toLocaleTimeString()} (running)`
            }
          />
        )}
        {dests.length > 0 && <MetaItem label="Destination" value={dests.join(", ")} mono />}
      </div>

      {(() => {
        // SSE event takes priority; fall back to job.status for fast jobs
        // where the stream hasn't connected yet.
        const phase = progress
          ? { index: progress.index, label: PHASES[progress.index] ?? progress.phase }
          : job.status === "pending"
            ? { index: 0, label: "Queued" }
            : job.status === "running"
              ? { index: 2, label: "Executing" }
              : null;
        if (!phase || progress?.phase === "complete") return null;
        return (
          <div className="mb-4 space-y-2">
            <Progress value={Math.round(((phase.index + 1) / PHASES.length) * 100)} />
            <p className="text-sm text-muted-foreground">{phase.label}...</p>
          </div>
        );
      })()}

      {hasPipeline && job.pipeline && (
        <PipelineSection pipeline={job.pipeline} className="flex-1 min-h-0 flex flex-col" />
      )}

      {job.error && <JobErrorBlock error={job.error} />}
    </div>
  );
}
