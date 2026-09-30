import type { SqlResult, VertexTable } from "@fossil-lang/corpus";

/** What an axis over a field can do with it: bin a range, draw a time axis, or group by value. */
export type FieldKind = "numeric" | "temporal" | "categorical";

/** The part a field plays in a chart by default. */
export type FieldRole = "identifier" | "dimension" | "measure";

export interface FieldStat {
  name: string;
  /** DuckDB's type for the column, as `SUMMARIZE` reports it. */
  type: string;
  kind: FieldKind;
  role: FieldRole;
  /** `approx_unique`: an estimate, which is all a default needs. */
  distinct: number;
}

export interface TableStats {
  name: string;
  count: number;
  fields: FieldStat[];
}

const NUMERIC = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|REAL|DECIMAL.*)$/i;
const TEMPORAL = /^(DATE|TIME.*|TIMESTAMP.*)$/i;
const ID_NAME = /(^id$|_id$|Id$|^uri$|^iri$)/;

/** A category with more values than this reads as a key, not as something to group by. */
const DIMENSION_LIMIT = 50;

export function kindOf(type: string): FieldKind {
  if (NUMERIC.test(type)) return "numeric";
  if (TEMPORAL.test(type)) return "temporal";
  return "categorical";
}

export function roleOf(name: string, kind: FieldKind, distinct: number, count: number): FieldRole {
  if (ID_NAME.test(name)) return "identifier";
  if (kind === "numeric") return "measure";
  if (kind === "temporal") return "dimension";
  return distinct <= DIMENSION_LIMIT || distinct < count / 2 ? "dimension" : "identifier";
}

/**
 * One table's `SUMMARIZE`, as the fields a chart or a rule may name. The table's key, its identity
 * and a layout's own coordinates are the corpus's bookkeeping rather than the program's data, so
 * they are left out.
 */
export function summarize(table: VertexTable, result: SqlResult): TableStats {
  const at = (column: string) => result.columns.indexOf(column);
  const [name, type, unique] = [at("column_name"), at("column_type"), at("approx_unique")];
  const hidden = new Set([table.key, table.identity]);
  if (table.position?.by === "layout") {
    hidden.add(table.position.x);
    hidden.add(table.position.y);
  }
  const fields = result.rows
    .filter((row) => !hidden.has(String(row[name])))
    .map((row): FieldStat => {
      const field = String(row[name]);
      const kind = kindOf(String(row[type]));
      const distinct = Number(row[unique] ?? 0);
      return { name: field, type: String(row[type]), kind, role: roleOf(field, kind, distinct, table.record_count), distinct };
    });
  return { name: table.name, count: table.record_count, fields };
}

/** One table's fields, by its name. */
export const fieldsOf = (tables: readonly TableStats[], name: string): FieldStat[] =>
  tables.find((t) => t.name === name)?.fields ?? [];
