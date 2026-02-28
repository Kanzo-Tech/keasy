"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Briefcase, Plus, Share2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { fetchJobs, deleteJob } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KnowledgeGraph } from "@/components/discovery/knowledge-graph";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <ActionItem
          variant="destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(job.id);
          }}
        >
          Delete
        </ActionItem>
      ) : null,
    ),
  ];
}

export default function JobsPage() {
  const router = useRouter();

  const { data: jobs, mutate } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteJob(id);
      toast.success("Job deleted");
      mutate();
    },
    [mutate],
  );

  const columns = useMemo(() => jobColumns(handleDelete), [handleDelete]);

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
    <Tabs defaultValue="jobs">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="jobs" className="gap-1.5">
            <Briefcase size={14} />
            Jobs
          </TabsTrigger>

          <TabsTrigger value="graph" className="gap-1.5">
            <Share2 size={14} />
            Graph
          </TabsTrigger>
        </TabsList>
        <Button asChild size="sm">
          <Link href="/jobs/new">
            <Plus size={14} className="mr-1" />
            Create job
          </Link>
        </Button>
      </div>

        <TabsContent value="jobs">
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
            <DataTable
              columns={columns}
              data={jobs}
              searchKey="name"
              searchPlaceholder="Search jobs..."
              onRowClick={handleRowClick}
            />
          )}
        </TabsContent>

        <TabsContent value="graph">
          <KnowledgeGraph />
        </TabsContent>
    </Tabs>
  );
}
