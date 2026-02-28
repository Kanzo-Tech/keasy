import { ExperimentalBadge } from "@/components/experimental-badge";
import { PipelineFlow } from "@/components/pipeline-flow";
import { Section } from "@/components/section";
import type { PipelineSummary } from "@/lib/types";

interface PipelineSectionProps {
  pipeline: PipelineSummary;
  className?: string;
}

export function PipelineSection({ pipeline, className }: PipelineSectionProps) {
  return (
    <Section
      label="Pipeline"
      className={className}
      action={<ExperimentalBadge />}
    >
      <PipelineFlow pipeline={pipeline} className="flex-1 min-h-0" />
    </Section>
  );
}
