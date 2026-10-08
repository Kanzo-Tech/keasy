"use client";

import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode } from "@uwdata/mosaic-sql";
import { useQueryRows } from "@kanzo-tech/ui/analytics";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleIndicator,
  CollapsibleTrigger,
  FormatNumber,
  SectionBody,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  StatDescription,
  StatLabel,
  StatRoot,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kanzo-tech/ui";
import type { Schemas } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { CorpusProvider, corpusQuery, useCorpus } from "@/lib/fossil/corpus";
import { formatDate, formatGraphDuration } from "@/lib/ui/format";
import { SchemaDiagram } from "./schema-diagram";
import type { EdgeTable, VertexType } from "./schema-layout";

/**
 * What a completed graph's corpus holds, as the corpus itself says it — opened with a read credential
 * vended for the graph. Suspends while it opens; keasy keeps no copy of it.
 */
export function Overview({ graph }: { graph: Schemas["Graph"] }) {
  const corpus = settled(useSuspenseQuery(corpusQuery(graph.id)));
  return (
    <CorpusProvider value={corpus}>
      <Holds graph={graph} />
    </CorpusProvider>
  );
}

interface Row {
  table_name: string;
  kind: "vertex" | "edge" | "property";
  rows: number;
  source: string | null;
  destination: string | null;
  column_name: string | null;
  type: string | null;
}

interface Held {
  name: string;
  rows: number;
  columns: { name: string; type: string }[];
}

const sum = (tables: { rows: number }[]) => tables.reduce((n, t) => n + t.rows, 0);

function Holds({ graph }: { graph: Schemas["Graph"] }) {
  const { graphId } = useCorpus();
  const rows = useQueryRows<Row>(
    `SELECT t.table_name, t.kind, t.rows::DOUBLE AS rows, t.source, t.destination, c.column_name, c.type
     FROM ${new TableRefNode([graphId, "fossil_tables"])} t
     LEFT JOIN ${new TableRefNode([graphId, "fossil_columns"])} c ON c.table_name = t.table_name
     WHERE t.kind <> 'property'
     ORDER BY t.table_name, c.ordinal`,
  );
  const { types, edges, held } = useMemo(() => {
    const tables = [...Map.groupBy(rows, (r) => r.table_name).values()];
    const held = new Map<string, Held>(
      tables.map(([t, ...rest]) => [
        t.table_name,
        {
          name: t.table_name,
          rows: t.rows,
          columns: [t, ...rest].flatMap((c) => (c.column_name ? [{ name: c.column_name, type: c.type ?? "" }] : [])),
        },
      ]),
    );
    const types: VertexType[] = tables
      .filter(([t]) => t.kind === "vertex")
      .map(([t]) => ({ name: t.table_name, rows: t.rows }));
    const edges: EdgeTable[] = tables
      .filter(([t]) => t.kind === "edge")
      .map(([t]) => ({ name: t.table_name, rows: t.rows, source: t.source ?? "", destination: t.destination ?? "" }));
    return { types, edges, held };
  }, [rows]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatRoot>
          <StatLabel>Vertices</StatLabel>
          <StatValue>
            <FormatNumber notation="compact" value={sum(types)} />
          </StatValue>
          <StatDescription>{count(types.length, "type")}</StatDescription>
        </StatRoot>
        <StatRoot>
          <StatLabel>Edges</StatLabel>
          <StatValue>
            <FormatNumber notation="compact" value={sum(edges)} />
          </StatValue>
          <StatDescription>{count(edges.length, "relation")}</StatDescription>
        </StatRoot>
        <StatRoot>
          <StatLabel>Run took</StatLabel>
          <StatValue>{formatGraphDuration(graph) || "—"}</StatValue>
          <StatDescription>{formatDate(graph.completed_at)}</StatDescription>
        </StatRoot>
      </div>

      <Part title="Schema">
        <SchemaDiagram edges={edges} types={types} />
      </Part>

      <Part title="Vertices">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead className="w-28 text-end">Rows</TableHead>
              <TableHead className="w-28 text-end">Columns</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          {types.map((t) => (
            <Columns key={t.name} table={held.get(t.name)!} />
          ))}
        </Table>
      </Part>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button className="-ms-2.5" variant="ghost">
            <span className="font-semibold">Edges</span>
            <span className="text-muted-foreground">{count(edges.length, "relation")}</span>
            <CollapsibleIndicator />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relation</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="w-28 text-end">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {edges.map((e) => (
                <TableRow key={e.name}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{e.source}</TableCell>
                  <TableCell>{e.destination}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    <FormatNumber value={e.rows} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** A vertex type's row, and under it, opened, the columns its table holds. */
function Columns({ table }: { table: Held }) {
  return (
    <Collapsible asChild>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">{table.name}</TableCell>
          <TableCell className="text-end tabular-nums">
            <FormatNumber value={table.rows} />
          </TableCell>
          <TableCell className="text-end tabular-nums">{table.columns.length}</TableCell>
          <TableCell>
            <CollapsibleTrigger asChild>
              <Button aria-label={`Columns of ${table.name}`} size="icon-sm" variant="ghost">
                <CollapsibleIndicator />
              </Button>
            </CollapsibleTrigger>
          </TableCell>
        </TableRow>
        <TableRow className="group-data-[state=closed]/collapsible:hidden">
          <TableCell className="p-0" colSpan={4}>
            <CollapsibleContent className="flex flex-wrap gap-1 px-3 py-2">
              {table.columns.map((c) => (
                <Badge className="font-normal" key={c.name} variant="secondary">
                  {c.name}
                  <span className="ml-1 text-muted-foreground">{c.type.toLowerCase()}</span>
                </Badge>
              ))}
            </CollapsibleContent>
          </TableCell>
        </TableRow>
      </TableBody>
    </Collapsible>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SectionRoot className="gap-3" fill={false}>
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>{title}</SectionTitle>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody>{children}</SectionBody>
    </SectionRoot>
  );
}
