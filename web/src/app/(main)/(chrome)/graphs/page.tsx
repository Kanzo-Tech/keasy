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
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { $api, invalidate, type Schemas } from "@/lib/api/client";
import { hasRunningGraphs, pollWhile, STATUS } from "@/lib/graphs";
import { toastError } from "@/lib/errors";
import { lower, WORDS } from "@/lib/vocabulary";
import { Boundary, Loading } from "@/components/boundary";
import { GRAPH_COLUMNS } from "@/components/graph-columns";
import { settled } from "@/lib/api/settled";
import { useSession } from "@kanzo-tech/auth";

type Graph = Schemas["Graph"];
type GraphStatus = Schemas["GraphStatus"];

const STATUS_OPTIONS = (Object.keys(STATUS) as GraphStatus[]).map((value) => ({ value, label: STATUS[value].label }));

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
  const editor = useSession().can("editor");
  const [deleting, setDeleting] = useState<Graph | null>(null);

  const graphs = settled(
    $api.useSuspenseQuery("get", "/v1/graphs", {}, { refetchInterval: pollWhile(hasRunningGraphs) }),
  );

  const { mutate: deleteGraph } = $api.useMutation("delete", "/v1/graphs/{id}", {
    onSuccess: () => {
      toast.create({ title: `${WORDS.graph} deleted`, type: "success" });
      void invalidate("/v1/graphs");
    },
    onError: (err) => toastError(err, `Could not delete the ${lower(WORDS.graph)}`),
  });

  const columns = useMemo<ColumnDef<Graph>[]>(
    () => [
      ...GRAPH_COLUMNS,
      actionsColumn<Graph>({
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
  // TanStack's page reset is queued as a microtask from inside render, so a reset that lands before
  // this component first commits is a state update React refuses (the facet filter's row model is
  // what reaches it), and every poll that changes a row sent the reader back to page one. The page
  // resets where it should: when the reader filters.
  const table = useDataTable({
    columns,
    data: graphs,
    autoResetPageIndex: false,
    onColumnFiltersChange: () => table.setPageIndex(0),
  });

  return graphs.length === 0 ? (
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
            <Link href="/graphs/new">New {lower(WORDS.graph)}</Link>
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
                <Link href="/graphs/new">
                  <Plus />
                  New {lower(WORDS.graph)}
                </Link>
              </Button>
            )}
          </div>
        </DataTableToolbar>
        <DataTableContent<Graph>
          empty={`No ${lower(WORDS.graphs)} match this filter.`}
          // One home per graph: its page, a draft's included; the recipe editor is reached from there.
          onRowClick={(graph) => router.push(`/graphs/${graph.id}`)}
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
              onClick={() => deleting && deleteGraph({ params: { path: { id: deleting.id } } })}
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
