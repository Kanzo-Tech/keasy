import type { FieldStat } from "@kanzo-tech/ui/analytics";
import type { Catalog, VertexTable } from "@/lib/fossil/corpus";

export interface TableStats {
  name: string;
  count: number;
  /** The program's columns a chart or a suggestion may name, classified. */
  fields: FieldStat[];
  /** Every column of the table, bookkeeping included: what a rule may check. */
  columns: string[];
}

/** The columns fossil wrote rather than the program: every one `fossil_columns` gives a `role`. */
export function bookkeeping(table: VertexTable): string[] {
  return table.properties.filter((p) => p.role !== undefined).map((p) => p.name);
}

/** The column the graph keys a vertex by — the `address` column, the same in every vertex table of one corpus. */
export function graphKey(catalog: Catalog): string {
  const key = catalog.vertex_tables[0]?.key;
  if (key === undefined) throw new Error("The corpus declares no vertex table, so nothing has a key");
  return key;
}

/** One table's columns, by its name: what a rule may check, fossil's own included. */
export const columnsOf = (tables: readonly TableStats[], name: string): string[] =>
  tables.find((t) => t.name === name)?.columns ?? [];
