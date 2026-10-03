"use client";

import { useMemo } from "react";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";

type Row = Record<string, unknown>;

/** A statement's answer, whoever wrote the statement: the columns are the first row's. */
export function ResultTable({ rows, pageSize }: { rows: readonly Row[]; pageSize: number }) {
  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      Object.keys(rows[0] ?? {}).map((key) => ({
        id: key,
        header: key,
        accessorFn: (row: Row) => row[key],
        cell: ({ row }) =>
          row.original[key] == null ? (
            <span className="text-muted-foreground">null</span>
          ) : (
            <span className="font-mono">{String(row.original[key])}</span>
          ),
      })),
    [rows],
  );
  const table = useDataTable({ columns: defs, data: rows as Row[], pageSize });
  return (
    <DataTableRoot className="gap-2" table={table}>
      <DataTableContent empty="No rows" />
      <DataTablePagination />
    </DataTableRoot>
  );
}
