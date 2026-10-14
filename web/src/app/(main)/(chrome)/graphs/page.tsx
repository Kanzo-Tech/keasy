"use client";

import { useMemo, useState } from "react";
import { Network } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  SectionBody,
  SectionRoot,
} from "@kanzo-tech/ui";
import { actionsColumn, type ColumnDef, DataTableFacetFilter } from "@kanzo-tech/ui/table";
import { useSession } from "@kanzo-tech/auth";
import { $api, type Schemas } from "@/lib/api/client";
import { hasRunningGraphs, pollWhile, STATUS } from "@/lib/graphs";
import { blocked } from "@/lib/permissions";
import { lower, WORDS } from "@/lib/vocabulary";
import { BlockedMenuItem } from "@/components/blocked";
import { GRAPH_COLUMNS } from "@/components/graph-columns";
import { ResourceList } from "@/components/resource-list";

type Graph = Schemas["Graph"];
type GraphStatus = Schemas["GraphStatus"];

const STATUS_OPTIONS = (Object.keys(STATUS) as GraphStatus[]).map((value) => ({ value, label: STATUS[value].label }));

export default function GraphsPage() {
  const editor = useSession().can("editor");
  const [deleting, setDeleting] = useState<Graph | null>(null);

  const { mutate: deleteGraph } = $api.useMutation("delete", "/v1/graphs/{id}", {
    meta: {
      success: `${WORDS.graph} deleted`,
      failure: `Could not delete the ${lower(WORDS.graph)}`,
      invalidates: ["/v1/graphs"],
    },
  });

  const columns = useMemo<ColumnDef<Graph>[]>(
    () => [
      ...GRAPH_COLUMNS,
      actionsColumn<Graph>({
        label: (row) => `Actions for ${row.original.name ?? row.original.id}`,
        // A reader is offered nothing; an editor is shown what this graph denies them, and why.
        menu: (row) =>
          editor ? (
            <BlockedMenuItem
              disabled={row.original.status === "running"}
              onSelect={() => setDeleting(row.original)}
              reason={blocked(row.original, "manage", lower(WORDS.graph))}
              value="delete"
              variant="destructive"
            >
              {row.original.status === "running" ? "Delete (stop the run first)" : "Delete"}
            </BlockedMenuItem>
          ) : null,
      }),
    ],
    [editor],
  );

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <ResourceList
          columns={columns}
          create={editor ? { label: `New ${lower(WORDS.graph)}`, href: "/graphs/new" } : undefined}
          empty={{
            icon: <Network />,
            title: `No ${lower(WORDS.graphs)} yet`,
            description: `A ${lower(WORDS.graph)} is a ${lower(WORDS.recipe)} over your connections, run to write its ${lower(WORDS.output)} to ${lower(WORDS.storage)}.`,
          }}
          filters={<DataTableFacetFilter column="status" label="Status" options={STATUS_OPTIONS} size="sm" />}
          // One home per graph: its page, a draft's included; the recipe editor is reached from there.
          href={(graph) => `/graphs/${graph.id}`}
          noun={lower(WORDS.graphs)}
          query={{ ...$api.queryOptions("get", "/v1/graphs"), refetchInterval: pollWhile(hasRunningGraphs) }}
        />
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
      </SectionBody>
    </SectionRoot>
  );
}
