"use client";

import { Badge } from "@kanzo-tech/ui";
import { type ColumnDef, facetFilterFn, sortableHeader } from "@kanzo-tech/ui/table";
import type { Schemas } from "@/lib/api/client";
import { copyOf } from "@/lib/errors";
import { runProblem, STATUS } from "@/lib/graphs";
import { formatDate, formatGraphDuration } from "@/lib/ui/format";

type Graph = Schemas["Graph"];
type GraphStatus = Schemas["GraphStatus"];

/** How a graph reads as a row, wherever graphs are listed: the list page and the dashboard alike. */
export const GRAPH_COLUMNS: ColumnDef<Graph>[] = [
  {
    accessorKey: "name",
    header: sortableHeader("Name"),
    cell: ({ row }) => <span className="font-medium">{row.original.name ?? row.original.id.slice(0, 8)}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue, row }) => {
      const { label, variant } = STATUS[getValue<GraphStatus>()];
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
    cell: ({ getValue }) => <span className="text-muted-foreground">{formatDate(getValue<string>())}</span>,
  },
  {
    id: "created_by",
    header: "Created by",
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.created_by.name}</span>,
  },
  {
    id: "duration",
    header: "Duration",
    cell: ({ row }) => <span className="text-muted-foreground">{formatGraphDuration(row.original)}</span>,
  },
];
