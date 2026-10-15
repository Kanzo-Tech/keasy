"use client";

import { useMemo } from "react";
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
import { CorpusProvider, useJoinGraph } from "@/lib/fossil/corpus";
import { counted, formatDate, formatGraphDuration } from "@/lib/ui/format";
import { PART_TABLE_HEIGHT } from "@/lib/ui/table-heights";

/**
 * What a completed graph holds, as the graph itself says it — opened with a read credential vended
 * for the graph, and read as the join graph the page's other parts read (`useJoinGraph`), so keasy
 * asks the catalogue no question of its own. Suspends while it opens; keasy keeps no copy of it.
 */
export function Overview({ graph }: { graph: Schemas["Graph"] }) {
  return (
    <CorpusProvider graphId={graph.id}>
      <Holds graph={graph} />
    </CorpusProvider>
  );
}

interface Held {
  name: string;
  rows: number;
  columns: { name: string; type: string }[];
}

/** A vertex type of the graph: GraphAr's `graphar_vertex_types` row, as the join graph reads it. */
interface VertexType {
  name: string;
  rows: number;
}

/** An edge type of the graph: its `source` and `destination` are the vertex types it joins. */
interface EdgeTable extends VertexType {
  source: string;
  destination: string;
}

const sum = (tables: { rows: number }[]) => tables.reduce((n, t) => n + t.rows, 0);

function Holds({ graph }: { graph: Schemas["Graph"] }) {
  const joins = useJoinGraph();
  const { types, edges, held } = useMemo(() => {
    // `vertices` is every type as one relation, the canvas's; the types are what the graph holds.
    const vertices = joins.types.filter((t) => t.of === undefined);
    const held = new Map<string, Held>(
      vertices.map((t) => [
        t.name,
        // The global id is the graph's own arithmetic over GraphAr's per-type index, not a column of the type.
        { name: t.name, rows: t.rows ?? 0, columns: t.columns.filter((c) => c.role !== "address").map((c) => ({ name: c.name, type: c.type })) },
      ]),
    );
    const types: VertexType[] = vertices.map((t) => ({ name: t.name, rows: t.rows ?? 0 }));
    const edges: EdgeTable[] = joins.edges.map((e) => ({ name: e.name, rows: e.rows ?? 0, source: e.source, destination: e.destination }));
    return { types, edges, held };
  }, [joins]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatRoot>
          <StatLabel>Vertices</StatLabel>
          <StatValue>
            <FormatNumber notation="compact" value={sum(types)} />
          </StatValue>
          <StatDescription>{counted(types.length, "type")}</StatDescription>
        </StatRoot>
        <StatRoot>
          <StatLabel>Edges</StatLabel>
          <StatValue>
            <FormatNumber notation="compact" value={sum(edges)} />
          </StatValue>
          <StatDescription>{counted(edges.length, "relation")}</StatDescription>
        </StatRoot>
        <StatRoot>
          <StatLabel>Run took</StatLabel>
          <StatValue>{formatGraphDuration(graph) || "—"}</StatValue>
          <StatDescription>{formatDate(graph.completed_at)}</StatDescription>
        </StatRoot>
      </div>

      <Part title="Vertices">
        <Table maxHeight={PART_TABLE_HEIGHT} stickyHeader>
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
            <span className="text-muted-foreground">{counted(edges.length, "relation")}</span>
            <CollapsibleIndicator />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Table maxHeight={PART_TABLE_HEIGHT} stickyHeader>
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
