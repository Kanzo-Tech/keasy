"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, MoreHorizontal, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionBody,
  SectionRoot,
  toast,
} from "@kanzo-tech/ui";
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
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { api } from "@/lib/api";
import { formatDate, formatJobDuration } from "@/lib/formatters";
import { queryKeys } from "@/lib/query-keys";
import type { Job, JobStatus } from "@/lib/types";
import { hasRunningJobs } from "@/lib/utils";

const DELETABLE: JobStatus[] = ["draft", "completed", "failed", "cancelled"];

export default function JobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: jobs = [] } = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: api.jobs.list,
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });

  const { mutate: remove } = useMutation({
    mutationFn: (id: string) => api.jobs.remove(id),
    onSuccess: () => {
      toast.create({ title: "Job deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: () => toast.create({ title: "Failed to delete job", type: "error" }),
  });

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      selectColumn<Job>(),
      {
        accessorKey: "name",
        header: sortableHeader("Name"),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name ?? row.original.id.slice(0, 8)}</span>
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
          <span className="text-muted-foreground capitalize">{getValue<string>()}</span>
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
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        size: 48,
        cell: ({ row }) =>
          DELETABLE.includes(row.original.status) && (
            <div className="text-end">
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    aria-label={`Actions for ${row.original.name ?? row.original.id}`}
                    onClick={(event) => event.stopPropagation()}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => remove(row.original.id)} value="delete" variant="destructive">
                    Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          ),
      },
    ],
    [remove],
  );
  const table = useDataTable({ columns, data: jobs });

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        {jobs.length === 0 ? (
          <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Briefcase />
            </ItemMedia>
            <ItemTitle className="text-base">No jobs yet</ItemTitle>
            <ItemDescription>Create a job to process and transform your data assets.</ItemDescription>
            <ItemActions>
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs/new">Create job</Link>
              </Button>
            </ItemActions>
          </Item>
        ) : (
          <DataTableRoot table={table}>
            <DataTableToolbar>
              <DataTableSearch column="name" placeholder="Search jobs..." />
              <div className="ms-auto flex items-center gap-2">
                <DataTableViewOptions />
                <Button asChild size="sm">
                  <Link href="/jobs/new">
                    <Plus />
                    Create job
                  </Link>
                </Button>
              </div>
            </DataTableToolbar>
            <DataTableContent<Job>
              empty="No jobs match this filter."
              onRowClick={(job) =>
                router.push(job.status === "draft" ? `/jobs/new?draft=${job.id}` : `/jobs/${job.id}`)
              }
            />
            <DataTablePagination />
          </DataTableRoot>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
