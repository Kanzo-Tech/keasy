"use client";

import { useMemo } from "react";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";
import type { SqlResult } from "@fossil-lang/corpus";

type Row = readonly unknown[];

/** A statement's answer, whoever wrote the statement: the columns come out of the result itself. */
export function ResultTable({ result, pageSize }: { result: SqlResult; pageSize: number }) {
  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((key, index) => ({
        id: key,
        header: key,
        accessorFn: (row: Row) => row[index],
        cell: ({ row }) =>
          row.original[index] == null ? (
            <span className="text-muted-foreground">null</span>
          ) : (
            <span className="font-mono">{String(row.original[index])}</span>
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
