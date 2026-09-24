"use client";

import { useMemo } from "react";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";
import type { ExecuteSqlResult } from "@fossil-lang/corpus";

type Row = Record<string, unknown>;

/** A statement's answer, whoever wrote the statement: the columns come out of the result itself. */
export function ResultTable({ result, pageSize }: { result: ExecuteSqlResult; pageSize: number }) {
  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      // Not `accessorKey`: a column named with a dot would read as a deep path.
      result.columns.map(({ name: key }) => ({
        id: key,
        accessorFn: (row: Row) => row[key],
        cell: ({ row }) =>
          row.original[key] == null ? (
            <span className="text-muted-foreground">null</span>
          ) : (
            <span className="font-mono">{String(row.original[key])}</span>
          ),
      })),
    [result],
  );
  const table = useDataTable({ columns: defs, data: result.rows as Row[], pageSize });
  return (
    <DataTableRoot className="gap-2" table={table}>
      {result.truncated && <p className="text-muted-foreground text-xs">Result truncated.</p>}
      <DataTableContent empty="No rows" />
      <DataTablePagination />
    </DataTableRoot>
  );
}
