"use client";

import { useMemo, useState } from "react";
import { Network, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
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
  DataTableFacetFilter,
  DataTablePagination,
  DataTableRoot,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  facetFilterFn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { $api, invalidate, type Schemas } from "@/lib/api/client";
import { formatDate, formatJobDuration } from "@/lib/ui/format";
import { hasRunningJobs, pollWhile, runProblem, STATUS } from "@/lib/jobs";
import { copyOf, toastError } from "@/lib/errors";
import { lower, WORDS } from "@/lib/vocabulary";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { useRole } from "@/lib/auth/use-role";

type Job = Schemas["Job"];
type JobStatus = Schemas["JobStatus"];

const STATUS_OPTIONS = (Object.keys(STATUS) as JobStatus[]).map((value) => ({ value, label: STATUS[value].label }));

export default function GraphsPage() {
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
          <Graphs />
        </Boundary>
      </SectionBody>
    </SectionRoot>
  );
}

function Graphs() {
  const router = useRouter();
  const editor = useRole().holds("editor");
  const [deleting, setDeleting] = useState<Job | null>(null);

  const jobs = settled(
    $api.useSuspenseQuery("get", "/v1/jobs", {}, { refetchInterval: pollWhile(hasRunningJobs) }),
  );

  const { mutate: deleteJob } = $api.useMutation("delete", "/v1/jobs/{id}", {
    onSuccess: () => {
      toast.create({ title: `${WORDS.graph} deleted`, type: "success" });
      void invalidate("/v1/jobs");
    },
    onError: (err) => toastError(err, `Could not delete the ${lower(WORDS.graph)}`),
  });

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
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
          const worded = row.original.status === "failed" ? copyOf(runProblem(row.original)?.code ?? "")?.title : undefined;
          if (worded) return <Badge variant="destructive">{worded}</Badge>;
          return <Badge variant={variant}>{label}</Badge>;
        },
        filterFn: facetFilterFn,
      },
      {
        accessorKey: "created_at",
        header: sortableHeader("Created"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatDate(getValue<string>())}</span>
        ),
      },
      {
        id: "created_by",
        header: "Created by",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.created_by.name}</span>,
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
          row.original.can_modify && row.original.status !== "running" ? (
            <MenuItem onSelect={() => setDeleting(row.original)} value="delete" variant="destructive">
              Delete
            </MenuItem>
          ) : null,
      }),
    ],
    [],
  );
  const table = useDataTable({ columns, data: jobs });

  return jobs.length === 0 ? (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyIndicator variant="icon">
          <Network />
        </EmptyIndicator>
        <EmptyTitle asChild>
          <h2>No {lower(WORDS.graphs)} yet</h2>
        </EmptyTitle>
        <EmptyDescription>
          A {lower(WORDS.graph)} is a {lower(WORDS.recipe)} over your connections, run to write its{" "}
          {lower(WORDS.output)} to {lower(WORDS.storage)}.
        </EmptyDescription>
      </EmptyHeader>
      {editor && (
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <Link href="/jobs/new">New {lower(WORDS.graph)}</Link>
          </Button>
        </EmptyContent>
      )}
    </EmptyRoot>
  ) : (
    <>
      <DataTableRoot table={table}>
        <DataTableToolbar>
          <DataTableSearch column="name" placeholder={`Search ${lower(WORDS.graphs)}...`} />
          <DataTableFacetFilter column="status" label="Status" options={STATUS_OPTIONS} size="sm" />
          <div className="ms-auto flex items-center gap-2">
            <DataTableViewOptions />
            {editor && (
              <Button asChild size="sm">
                <Link href="/jobs/new">
                  <Plus />
                  New {lower(WORDS.graph)}
                </Link>
              </Button>
            )}
          </div>
        </DataTableToolbar>
        <DataTableContent<Job>
          empty={`No ${lower(WORDS.graphs)} match this filter.`}
          // One home per graph: its page, a draft's included; the recipe editor is reached from there.
          onRowClick={(job) => router.push(`/jobs/${job.id}`)}
        />
        <DataTablePagination />
      </DataTableRoot>
      <AlertDialog onOpenChange={(d) => !d.open && setDeleting(null)} open={deleting !== null}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader
            description={`${deleting?.name ?? deleting?.id ?? ""} and its record go. Its ${lower(WORDS.output)} stays in ${lower(WORDS.storage)}.`}
            title={`Delete this ${lower(WORDS.graph)}?`}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteJob({ params: { path: { id: deleting.id } } })}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
