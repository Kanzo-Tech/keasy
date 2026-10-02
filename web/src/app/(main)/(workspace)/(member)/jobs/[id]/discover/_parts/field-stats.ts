import type { Manifest, VertexTable } from "@fossil-lang/corpus";
import { type FieldStat, fieldStats, type SummarizeRow } from "@kanzo-tech/ui/analytics";

export interface TableStats {
  name: string;
  count: number;
  /** The program's columns a chart or a suggestion may name, classified. */
  fields: FieldStat[];
  /** Every column of the table, bookkeeping included: what a rule may check. */
  columns: string[];
}

/**
 * The columns fossil wrote rather than the program: every one with a `role`. A corpus written
 * before fossil 0.3.0-alpha.22 has no roles, so there it is what the manifest has always declared —
 * the key, the identity and a layout's coordinates; its `cluster_id` and edge endpoints read as data.
 */
export function bookkeeping(table: VertexTable): string[] {
  const roled = table.properties.filter((p) => p.role !== undefined).map((p) => p.name);
  if (roled.length > 0) return roled;
  const layout = table.position?.by === "layout" ? [table.position.x, table.position.y] : [];
  return [table.key, table.identity, ...layout];
}

/** The column the graph keys a vertex by, the same in every vertex table of one corpus. */
export function graphKey(manifest: Manifest): string {
  const key = manifest.vertex_tables[0]?.key;
  if (key === undefined) throw new Error("The corpus declares no vertex table, so nothing has a key");
  return key;
}

/** One table's `SUMMARIZE` rows, as kanzo-ui classifies them, with fossil's bookkeeping left out of its fields. */
export function summarize(table: VertexTable, rows: readonly Record<string, unknown>[]): TableStats {
  const { fields, columns } = fieldStats(rows as unknown as SummarizeRow[], { exclude: bookkeeping(table) });
  return { name: table.name, count: table.record_count, fields, columns };
}

/** One table's columns, by its name: what a rule may check, fossil's own included. */
export const columnsOf = (tables: readonly TableStats[], name: string): string[] =>
  tables.find((t) => t.name === name)?.columns ?? [];
