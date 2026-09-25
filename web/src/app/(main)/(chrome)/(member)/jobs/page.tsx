"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, MoreHorizontal, Plus } from "lucide-react";
import {
  Badge,
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
import { $api, invalidate, type Schemas } from "@/lib/api/client";
import { formatDate, formatJobDuration } from "@/lib/formatters";
import { hasRunningJobs, isTerminalStatus } from "@/lib/jobs";

type Job = Schemas["Job"];
type JobStatus = Schemas["JobStatus"];

const STATUS: Record<JobStatus, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Pending", variant: "warning" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export default function JobsPage() {
  const router = useRouter();

  const { data: jobs = [] } = $api.useQuery("get", "/v1/jobs", {}, {
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });

  const { mutate: deleteJob } = $api.useMutation("delete", "/v1/jobs/{id}", {
    onSuccess: () => {
      toast.create({ title: "Job deleted", type: "success" });
      void invalidate("/v1/jobs");
    },
    onError: () => toast.create({ title: "Failed to delete job", type: "error" }),
  });
  const remove = useCallback(
    (id: string) => deleteJob({ params: { path: { id } } }),
    [deleteJob],
  );

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
        cell: ({ getValue }) => {
          const { label, variant } = STATUS[getValue<JobStatus>()];
          return <Badge variant={variant}>{label}</Badge>;
        },
        filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
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
          (row.original.status === "draft" || isTerminalStatus(row.original.status)) && (
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
