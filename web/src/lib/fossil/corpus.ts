/**
 * A job's corpus, attached to the page's one engine — the one door keasy walks through to read an
 * output — and the two reads keasy makes of it: what it holds, and an arbitrary statement.
 *
 * The host's whole job here is access: fossil asks {@link host} for a read credential on the job's
 * dataset, installs it in the engine scoped to that prefix, renews it before it expires, and
 * attaches the corpus under the job's id. Everything after that is SQL through the coordinator —
 * the charts', the graph's and these.
 */

import "client-only";

import { open, type Close } from "@fossil-lang/corpus";
import { engine, type Coordinator } from "@kanzo-tech/ui/analytics";

import { host } from "@/lib/fossil/host";

/** The root of every cached read of a job's opened output; its own, so invalidating a job never reopens it. */
export const corpusKey = (jobId: string) => ["corpus", jobId] as const;

/** Attach the corpus a completed job wrote, under the job's id. The caller detaches it; `signal` stops the open. */
export async function openJobCorpus(jobId: string, { signal }: { signal?: AbortSignal } = {}): Promise<Close> {
  return open(jobId, { engine: await engine({ signal }), host, signal });
}

/** A table of an attached corpus, as SQL names it. */
export const relation = (jobId: string, table: string) => `"${jobId.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`;

/** One column, as `fossil_columns` describes it: `role` is the writer's (`address`, `identity`, `endpoint`), absent on a program's. */
export interface Property {
  readonly name: string;
  readonly type: string;
  readonly role?: string;
  readonly iri?: string;
  readonly nullable: boolean;
}

export interface VertexTable {
  readonly name: string;
  readonly iri?: string;
  /** Its file, relative to the corpus root. */
  readonly path: string;
  /** The `address` column — `dense_id`. */
  readonly key: string;
  /** The `identity` column — `subject`. */
  readonly identity: string;
  readonly record_count: number;
  readonly properties: readonly Property[];
}

export interface EdgeTable {
  readonly name: string;
  readonly iri?: string;
  readonly path: string;
  readonly record_count: number;
  readonly source: { readonly key: string; readonly references: string };
  readonly destination: { readonly key: string; readonly references: string };
  readonly properties: readonly Property[];
}

/** What an attached corpus holds, read from its `fossil_tables` and `fossil_columns`. */
export interface Catalog {
  readonly vertex_tables: readonly VertexTable[];
  readonly edge_tables: readonly EdgeTable[];
}

/** An answer's rows as plain objects. */
async function rowsOf(coordinator: Coordinator, sql: string): Promise<Record<string, unknown>[]> {
  return Array.from((await coordinator.query(sql, { type: "json" })) as Iterable<Record<string, unknown>>);
}

const text = (value: unknown) => (value === null || value === undefined ? undefined : String(value));

/** The attached corpus's two relations, as the tables keasy lists, colours and describes. */
export async function readCatalog(coordinator: Coordinator, jobId: string): Promise<Catalog> {
  const [tables, columns] = await Promise.all([
    rowsOf(coordinator, `SELECT table_name, kind, iri, path, rows::DOUBLE AS rows, source, destination FROM ${relation(jobId, "fossil_tables")}`),
    rowsOf(coordinator, `SELECT table_name, column_name, type, role, iri, nullable FROM ${relation(jobId, "fossil_columns")} ORDER BY table_name, ordinal`),
  ]);
  const propertiesOf = (table: string): Property[] =>
    columns
      .filter((c) => c.table_name === table)
      .map((c) => ({ name: String(c.column_name), type: String(c.type), role: text(c.role), iri: text(c.iri), nullable: c.nullable === true }));
  const byRole = (properties: readonly Property[], role: string, fallback: string) =>
    properties.find((p) => p.role === role)?.name ?? fallback;
  const vertex_tables: VertexTable[] = [];
  const edge_tables: EdgeTable[] = [];
  for (const t of tables) {
    const name = String(t.table_name);
    const properties = propertiesOf(name);
    const common = { name, iri: text(t.iri), path: String(t.path), record_count: Number(t.rows), properties };
    if (t.kind === "vertex") {
      vertex_tables.push({ ...common, key: byRole(properties, "address", "dense_id"), identity: byRole(properties, "identity", "subject") });
    } else {
      edge_tables.push({
        ...common,
        source: { key: "src", references: String(t.source) },
        destination: { key: "dst", references: String(t.destination) },
      });
    }
  }
  return { vertex_tables, edge_tables };
}

/** What {@link runSql} answers: the columns, the rows as arrays, and whether it stopped short. */
export interface SqlResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** More rows than `limit` matched, and only `limit` came back. */
  readonly truncated: boolean;
}

/**
 * **One statement, as written**, through the page's coordinator — the Ask agent's and SUMMARIZE's.
 * At most `limit` rows come back, whatever the statement's own `LIMIT` says: one row past it says the
 * cap bit.
 */
export async function runSql(coordinator: Coordinator, statement: string, { limit = 10_000 } = {}): Promise<SqlResult> {
  const body = statement.trim().replace(/;+\s*$/, "");
  const rows = await rowsOf(coordinator, `SELECT * FROM (${body}) AS _q LIMIT ${limit + 1}`);
  const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
  return {
    columns,
    rows: rows.slice(0, limit).map((row) => columns.map((c) => row[c] ?? null)),
    truncated: rows.length > limit,
  };
}
