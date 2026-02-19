import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { MetaItem } from "@/components/meta-item";
import { PipelineSummary } from "@/components/pipeline-summary";
import { Section } from "@/components/section";
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
    <>
      {/* Metadata */}
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
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

      {/* Pipeline */}
      {hasPipeline && (
        <Section label="Pipeline" className="mb-8">
          <PipelineSummary
            sources={job.sources ?? []}
            outputs={job.outputs ?? []}
            hideDestination
          />
        </Section>
      )}

      {job.error && (
        <div className="mb-8 flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <pre className="whitespace-pre-wrap font-mono text-sm">{job.error.message}</pre>
          </div>
          {job.error.code.startsWith("CLOUD_") && (
            <Button variant="outline" size="sm" className="w-fit" asChild>
              <Link href="/settings?tab=cloud-accounts">Go to Cloud Accounts</Link>
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

      {/* Cancel */}
      {!isTerminal && (
        <Button variant="destructive" onClick={onCancel}>
          Cancel Job
        </Button>
      )}
    </>
  );
}
