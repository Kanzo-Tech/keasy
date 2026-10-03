"use client";

import { useState } from "react";
import { Boxes, Table2 } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode } from "@uwdata/mosaic-sql";
import { useQueryRows } from "@kanzo-tech/ui/analytics";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kanzo-tech/ui";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { $api, type Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/ui/format";
import { CorpusProvider, corpusQuery } from "@/app/(main)/(workspace)/(member)/jobs/[id]/discover/_parts/corpus";

export default function DatasetsPage() {
  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Data Catalog
          </SectionTitle>
          <SectionDescription>
            Every dataset the workspace produced. Open one to see what it holds, as the dataset
            itself describes it; the data stays at its sink.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        <Boundary
          fallback={
            <Loading>
              <Skeleton className="h-40 w-full" />
            </Loading>
          }
        >
          <Datasets />
        </Boundary>
      </SectionBody>
    </SectionRoot>
  );
}

function Datasets() {
  const datasets = settled($api.useSuspenseQuery("get", "/v1/datasets"));
  const [chosen, choose] = useState<Schemas["Dataset"] | null>(null);
  if (datasets.length === 0) {
    return (
      <EmptyRoot>
        <EmptyHeader>
          <EmptyIndicator variant="icon">
            <Boxes />
          </EmptyIndicator>
          <EmptyTitle asChild>
            <h2>No datasets yet</h2>
          </EmptyTitle>
          <EmptyDescription>When a job completes, its output is listed here.</EmptyDescription>
        </EmptyHeader>
      </EmptyRoot>
    );
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dataset</TableHead>
            <TableHead>Written</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {datasets.map((dataset) => (
            <TableRow
              key={dataset.id}
              className="cursor-pointer"
              data-state={chosen?.id === dataset.id ? "selected" : undefined}
              onClick={() => choose(dataset)}
            >
              <TableCell className="font-medium">{dataset.name ?? dataset.id}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(dataset.completed_at)}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{dataset.dest}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {chosen && (
        <Boundary
          key={chosen.id}
          fallback={
            <Loading>
              <Skeleton className="h-40 w-full" />
            </Loading>
          }
        >
          <Opened dataset={chosen} />
        </Boundary>
      )}
    </>
  );
}

/** The dataset's corpus, opened with a read credential for the job that wrote it. */
function Opened({ dataset }: { dataset: Schemas["Dataset"] }) {
  const corpus = settled(useSuspenseQuery(corpusQuery(dataset.id)));
  return (
    <CorpusProvider value={corpus}>
      <Holds dataset={dataset} />
    </CorpusProvider>
  );
}

interface Column {
  table_name: string;
  rows: number;
  column_name: string | null;
  type: string | null;
}

/** What the corpus says it holds: each table of its `fossil_tables`, with its `fossil_columns`. */
function Holds({ dataset }: { dataset: Schemas["Dataset"] }) {
  const rows = useQueryRows<Column>(
    `SELECT t.table_name, t.rows::DOUBLE AS rows, c.column_name, c.type
     FROM ${new TableRefNode([dataset.id, "fossil_tables"])} t
     LEFT JOIN ${new TableRefNode([dataset.id, "fossil_columns"])} c ON c.table_name = t.table_name
     ORDER BY t.kind DESC, t.table_name, c.ordinal`,
  );
  const tables = Map.groupBy(rows, (r) => r.table_name);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Boxes size={15} className="text-muted-foreground" />
          {dataset.name ?? dataset.id}
        </CardTitle>
      </CardHeader>
      <CardContent>
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
                    {columns.flatMap((c) =>
                      c.column_name === null
                        ? []
                        : [
                            <Badge key={c.column_name} variant="secondary" className="font-normal">
                              {c.column_name}
                              <span className="ml-1 text-muted-foreground">{c.type?.toLowerCase()}</span>
                            </Badge>,
                          ],
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
