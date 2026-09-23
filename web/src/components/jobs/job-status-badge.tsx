import { Badge } from "@kanzo-tech/ui";
import type { JobStatus } from "@/lib/types";

/**
 * A status is one of the design system's status families, not a hand-picked tone. The
 * variants carry the measured pairing — a step-9 wash under step-11 ink — and they follow
 * the theme. A literal palette step with a second one hand-picked for dark mode did neither.
 */
const config: Record<JobStatus, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Pending", variant: "warning" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { label, variant } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}
