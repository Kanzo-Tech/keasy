"use client";

import { useCallback, useMemo } from "react";
import { Briefcase, Plus } from "lucide-react";
import {
  Badge,
  Button,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  MenuItem,
  SectionBody,
  SectionRoot,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import {
  actionsColumn,
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
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { $api, invalidate, type Schemas } from "@/lib/api/client";
import { formatDate, formatJobDuration } from "@/lib/ui/format";
import { hasRunningJobs, isTerminalStatus, pollWhile, runProblem } from "@/lib/jobs";
import { copyOf, toastError } from "@/lib/errors";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { useRole } from "@/lib/auth/use-role";

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
  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <Boundary
          fallback={
            <Loading>
              <Skeleton className="h-40 w-full" />
            </Loading>
          }
        >
          <Jobs />
        </Boundary>
      </SectionBody>
    </SectionRoot>
  );
}

function Jobs() {
  const router = useRouter();
  const editor = useRole().holds("editor");

  const jobs = settled(
    $api.useSuspenseQuery("get", "/v1/jobs", {}, { refetchInterval: pollWhile(hasRunningJobs) }),
  );

  const { mutate: deleteJob } = $api.useMutation("delete", "/v1/jobs/{id}", {
    onSuccess: () => {
      toast.create({ title: "Job deleted", type: "success" });
      void invalidate("/v1/jobs");
    },
    onError: (err) => toastError(err, "Failed to delete job"),
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
        cell: ({ getValue, row }) => {
          const { label, variant } = STATUS[getValue<JobStatus>()];
          // A failure keasy has its own words for says them; any other says "Failed".
          const worded = copyOf(runProblem(row.original)?.code ?? "")?.title;
          if (worded) return <Badge variant="destructive">{worded}</Badge>;
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
      actionsColumn<Job>({
        label: (row) => `Actions for ${row.original.name ?? row.original.id}`,
        menu: (row) =>
          row.original.can_modify && (row.original.status === "draft" || isTerminalStatus(row.original.status)) ? (
            <MenuItem onSelect={() => remove(row.original.id)} value="delete" variant="destructive">
              Delete
            </MenuItem>
          ) : null,
      }),
    ],
    [remove],
  );
  const table = useDataTable({ columns, data: jobs });

  return jobs.length === 0 ? (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyIndicator variant="icon">
          <Briefcase />
        </EmptyIndicator>
        <EmptyTitle asChild>
          <h2>No jobs yet</h2>
        </EmptyTitle>
        <EmptyDescription>Create a job to process and transform your data assets.</EmptyDescription>
      </EmptyHeader>
      {editor && (
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/jobs/new">Create job</Link>
          </Button>
        </EmptyContent>
      )}
    </EmptyRoot>
  ) : (
    <DataTableRoot table={table}>
      <DataTableToolbar>
        <DataTableSearch column="name" placeholder="Search jobs..." />
        <div className="ms-auto flex items-center gap-2">
          <DataTableViewOptions />
          {editor && (
            <Button asChild size="sm">
              <Link href="/jobs/new">
                <Plus />
                Create job
              </Link>
            </Button>
          )}
        </div>
      </DataTableToolbar>
      <DataTableContent<Job>
        empty="No jobs match this filter."
        onRowClick={(job) =>
          // A draft opens in the editor only for whoever may change it.
          router.push(job.status === "draft" && job.can_modify ? `/jobs/new?draft=${job.id}` : `/jobs/${job.id}`)
        }
      />
      <DataTablePagination />
    </DataTableRoot>
  );
}
