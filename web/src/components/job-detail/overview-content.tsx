import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { MetaItem } from "@/components/meta-item";
import { PipelineSection } from "@/components/pipeline-section";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDuration } from "@/lib/formatters";
import type { Job } from "@/lib/types";

interface OverviewContentProps {
  job: Job;
  dests: string[];
  hasPipeline: boolean;
  isTerminal: boolean;
  onCancel: () => void;
}

export function OverviewContent({
  job,
  dests,
  hasPipeline,
  isTerminal,
  onCancel,
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

      {hasPipeline && job.pipeline && (
        <PipelineSection pipeline={job.pipeline} className="flex-1 min-h-0 flex flex-col" />
      )}

      {job.error && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <pre className="whitespace-pre-wrap font-mono text-sm">{job.error.message}</pre>
          </div>
          {job.error.code.startsWith("CLOUD_") && (
            <Button variant="outline" size="sm" className="w-fit" asChild>
              <Link href="/settings/cloud-accounts">Go to Cloud Accounts</Link>
            </Button>
          )}
          {job.error.detail && (
            <Collapsible>
              <CollapsibleTrigger className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100">
                Technical details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs opacity-70">{job.error.detail}</pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {!isTerminal && (
        <Button variant="destructive" onClick={onCancel} className="mt-4 w-fit">
          Cancel Job
        </Button>
      )}
    </div>
  );
}
