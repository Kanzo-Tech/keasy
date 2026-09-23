"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Plus } from "lucide-react";
import { toast } from "@kanzo-tech/ui";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { hasRunningJobs } from "@/lib/utils";
import { Button, MenuItem } from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  selectColumn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { actionsColumn } from "@/components/shared/actions-column";
import { EmptyState } from "@/components/shared/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { formatDate, formatJobDuration } from "@/lib/formatters";
import type { Job, JobStatus } from "@/lib/types";

const TERMINAL_STATUSES: JobStatus[] = ["draft", "completed", "failed", "cancelled"];

function jobColumns(onDelete: (id: string) => void): ColumnDef<Job>[] {
  return [
    selectColumn<Job>(),
    {
      accessorKey: "name",
      header: sortableHeader("Name"),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.name ?? row.original.id.slice(0, 8)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => <JobStatusBadge status={getValue<JobStatus>()} />,
      filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "mode",
      header: "Mode",
      cell: ({ getValue }) => (
        <span className="capitalize text-muted-foreground">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: "created_at",
      header: sortableHeader("Created"),
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{formatDate(getValue<string>())}</span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatJobDuration(row.original)}</span>
      ),
    },
    actionsColumn<Job>((job) =>
      TERMINAL_STATUSES.includes(job.status) ? (
        <MenuItem
          onSelect={() => onDelete(job.id)}
          value="delete"
          variant="destructive"
        >
          Delete
        </MenuItem>
      ) : null,
    ),
  ];
}

export default function JobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: jobs } = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: api.jobs.list,
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.jobs.remove(id),
    onSuccess: () => {
      toast.create({ title: "Job deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: () => toast.create({ title: "Failed to delete job", type: "error" }),
  });

  const handleDelete = useCallback(
    (id: string) => { deleteMutation.mutate(id); },
    [deleteMutation],
  );

  const columns = useMemo(() => jobColumns(handleDelete), [handleDelete]);

  const table = useDataTable({ columns, data: jobs ?? [] });

  const handleRowClick = useCallback(
    (job: Job) => {
      if (job.status === "draft") {
        router.push(`/jobs/new?draft=${job.id}`);
      } else {
        router.push(`/jobs/${job.id}`);
      }
    },
    [router],
  );

  return (
    <PageShell>
    <PageShell.Content className="overflow-hidden">
    {!jobs?.length ? (
    <EmptyState
      icon={Briefcase}
      title="No jobs yet"
      description={
        <>
          <Link href="/jobs/new" className="underline underline-offset-4 hover:text-foreground">
            Create a job
          </Link>{" "}
          to process and transform your data assets.
        </>
      }
    />
  ) : (
    <DataTableRoot table={table}>
      <DataTableToolbar>
        <DataTableSearch column="name" placeholder="Search jobs..." />
        <div className="ms-auto flex items-center gap-2">
          <DataTableViewOptions />
          <Button asChild size="sm">
            <Link href="/jobs/new">
              <Plus size={14} />
              Create job
            </Link>
          </Button>
        </div>
      </DataTableToolbar>
      <DataTableContent<Job> empty="No jobs match this filter." onRowClick={handleRowClick} />
      <DataTablePagination />
    </DataTableRoot>
    )}
    </PageShell.Content>
    </PageShell>
  );
}
