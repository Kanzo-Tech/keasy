"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Alert, AlertDescription, Button, Kbd, ScrollArea, Spinner, Textarea } from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";
import type { ExecuteSqlResult } from "@fossil-lang/corpus";
import { useCorpus } from "./corpus";

type Row = Record<string, unknown>;

/**
 * Raw SQL over the producer's own dataset, run in the browser by `corpus.executeSql`
 * (DuckDB-WASM over the signed-URL Parquet). Sovereignty is enforced where the URLs are signed:
 * only the producer gets them for their job.
 */
export function SqlPanel() {
  const { corpus } = useCorpus();
  const [sql, setSql] = useState("");
  const run = useMutation({ mutationFn: (statement: string) => corpus.executeSql({ sql: statement }) });
  const submit = () => {
    if (sql.trim() && !run.isPending) run.mutate(sql);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b p-2">
        <Textarea
          className="h-24 resize-none font-mono text-xs"
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder='SELECT * FROM "Person" LIMIT 10'
          spellCheck={false}
          value={sql}
        />
        <Button className="w-full" disabled={run.isPending || !sql.trim()} onClick={submit} size="sm">
          {run.isPending ? <Spinner /> : <Play />}
          Run <Kbd>⌘↵</Kbd>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {run.error && (
            <Alert variant="destructive">
              <AlertDescription className="break-all font-mono text-xs">{run.error.message}</AlertDescription>
            </Alert>
          )}
          {run.data?.truncated && <p className="text-muted-foreground text-xs">Result truncated.</p>}
          {run.data && <ResultTable result={run.data} />}
        </div>
      </ScrollArea>
    </div>
  );
}

function ResultTable({ result }: { result: ExecuteSqlResult }) {
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
  const table = useDataTable({ columns: defs, data: result.rows as Row[], pageSize: 20 });
  return (
    <DataTableRoot className="gap-2" table={table}>
      <DataTableContent empty="No rows" />
      <DataTablePagination />
    </DataTableRoot>
  );
}
