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
import { DeleteButton } from "@/components/delete-button";
import { JobStatusBadge } from "@/components/job-status-badge";
import { formatJobDuration, formatDate } from "@/lib/formatters";
import { deleteJob } from "@/lib/api";
import type { Job, JobStatus } from "@/lib/types";

function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function JobTable({ jobs, onDelete }: { jobs: Job[]; onDelete?: () => void }) {
  const router = useRouter();

  if (jobs.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No jobs yet. Create one to get started.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow
            key={job.id}
            className="cursor-pointer"
            onClick={() => router.push(`/jobs/${job.id}`)}
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
