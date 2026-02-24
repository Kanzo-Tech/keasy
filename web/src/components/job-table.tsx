"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Briefcase } from "lucide-react";
import { ColumnFilter } from "@/components/column-filter";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { JobStatusBadge } from "@/components/job-status-badge";
import { formatJobDuration, formatDate } from "@/lib/formatters";
import { deleteJob } from "@/lib/api";
import type { Job, JobStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "draft";
}

interface JobTableProps {
  jobs: Job[];
  statusFilter: Set<JobStatus>;
  onStatusFilterChange: (filter: Set<JobStatus>) => void;
  onDelete?: () => void;
}

export function JobTable({ jobs, statusFilter, onStatusFilterChange, onDelete }: JobTableProps) {
  const router = useRouter();

  const filtered =
    statusFilter.size > 0
      ? jobs.filter((j) => statusFilter.has(j.status))
      : jobs;

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No jobs"
        description={statusFilter.size > 0 ? "No jobs match the selected filters." : "Create a job to get started."}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>
            <ColumnFilter
              label="Status"
              options={STATUS_OPTIONS}
              selected={statusFilter}
              onChange={onStatusFilterChange}
            />
          </TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((job) => (
          <TableRow
            key={job.id}
            className="cursor-pointer"
            onClick={() => router.push(job.status === "draft" ? `/jobs/new?draft=${job.id}` : `/jobs/${job.id}`)}
          >
            <TableCell className="font-medium">
              {job.name ?? job.id.slice(0, 8)}
            </TableCell>
            <TableCell>
              <JobStatusBadge status={job.status} />
            </TableCell>
            <TableCell className="text-muted-foreground capitalize">
              {job.mode}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(job.created_at)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatJobDuration(job)}
            </TableCell>
            <TableCell>
              {isTerminal(job.status) && (
                <DeleteButton
                  iconOnly
                  title="Delete job"
                  description="This will permanently delete this job and its catalog data. This action cannot be undone."
                  onConfirm={async () => {
                    await deleteJob(job.id);
                    toast.success("Job deleted");
                    onDelete?.();
                  }}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
