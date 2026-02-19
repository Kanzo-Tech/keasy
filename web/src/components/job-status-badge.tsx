import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

const config: Record<JobStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  },
  running: {
    label: "Running",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = config[status];
  return <Badge className={className}>{label}</Badge>;
}
