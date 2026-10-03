"use client";

import { Table2 } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode } from "@uwdata/mosaic-sql";
import { useQueryRows } from "@kanzo-tech/ui/analytics";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@kanzo-tech/ui";
import { settled } from "@/lib/api/settled";
import { CorpusProvider, corpusQuery, useCorpus } from "@/lib/fossil/corpus";

/**
 * What a completed graph's corpus holds, as the corpus itself says it — opened with a read credential
 * vended for the graph. Suspends while it opens; keasy keeps no copy of it.
 */
export function CorpusHolds({ graphId }: { graphId: string }) {
  const corpus = settled(useSuspenseQuery(corpusQuery(graphId)));
  return (
    <CorpusProvider value={corpus}>
      <Holds />
    </CorpusProvider>
  );
}

interface Column {
  table_name: string;
  rows: number;
  column_name: string | null;
  type: string | null;
}

/** Each table of the corpus's `fossil_tables`, its row count, and its `fossil_columns`. */
function Holds() {
  const { graphId } = useCorpus();
  const rows = useQueryRows<Column>(
    `SELECT t.table_name, t.rows::DOUBLE AS rows, c.column_name, c.type
     FROM ${new TableRefNode([graphId, "fossil_tables"])} t
     LEFT JOIN ${new TableRefNode([graphId, "fossil_columns"])} c ON c.table_name = t.table_name
     ORDER BY t.kind DESC, t.table_name, c.ordinal`,
  );
  const tables = Map.groupBy(rows, (r) => r.table_name);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Table</TableHead>
          <TableHead className="w-24 text-right">Rows</TableHead>
          <TableHead>Columns</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...tables].map(([name, columns]) => (
          <TableRow key={name}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <Table2 size={14} className="text-muted-foreground" />
                {name}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {columns[0].rows.toLocaleString()}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {columns
                  .filter((c) => c.column_name !== null)
                  .map((c) => (
                    <Badge key={c.column_name} variant="secondary" className="font-normal">
                      {c.column_name}
                      <span className="ml-1 text-muted-foreground">{c.type?.toLowerCase()}</span>
                    </Badge>
                  ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
