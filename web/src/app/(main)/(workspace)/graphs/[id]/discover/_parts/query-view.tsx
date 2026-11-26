"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayIcon, SquareIcon, TableIcon } from "lucide-react";
import { Button } from "@kanzo-tech/ui";
import { useAttachedGraph } from "@/lib/fossil/graph";

/**
 * The Query view: SQL typed by the reader, run on the page's one DuckDB over the graph that is already
 * attached to it, the same engine the dashboard, the graph and the rules read through. Nothing leaves
 * the browser and nothing is written: a query is one read-only statement, and its answer is drawn as a
 * table of at most `MAX_ROWS` rows. The aside lists the graph's tables and columns, and a table pressed
 * there starts a query over it.
 */

type Engine = ReturnType<typeof useAttachedGraph>["engine"];
type Answer = Awaited<ReturnType<Engine["query"]>>;

/** How many rows of an answer are drawn: a larger answer is counted, not drawn. */
const MAX_ROWS = 1000;

/** The statements a query may start with: every one of them only reads. */
const READ_ONLY = /^\s*(select|with|from|describe|show|summarize|explain)\b/i;

interface Column {
  table: string;
  column: string;
  type: string;
}

interface Result {
  names: string[];
  rows: string[][];
  total: number;
  ms: number;
}

/** `name` as a quoted SQL identifier. */
function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A cell as text: `—` for a missing value, and a big integer, a date or a nested value made readable. */
function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  }
  return String(value);
}

/** The value of `name` in row `i` of an answer. */
function cell(answer: Answer, name: string, i: number): unknown {
  return answer.getChild(name)?.get(i);
}

export default function QueryView() {
  const { name, engine } = useAttachedGraph();
  const [sql, setSql] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [schemaError, setSchemaError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const running$ = useRef<AbortController | null>(null);

  // The graph's tables and their columns, read once from DuckDB's catalog. The graph is attached
  // under `name`, so its tables are the ones whose database or schema carries that name.
  useEffect(() => {
    const controller = new AbortController();
    const literal = name.replace(/'/g, "''");
    engine
      .query(
        `SELECT table_name, column_name, data_type FROM duckdb_columns() ` +
          `WHERE database_name = '${literal}' OR schema_name = '${literal}' ` +
          `ORDER BY table_name, column_index`,
        { signal: controller.signal },
      )
      .then((answer) => {
        const read: Column[] = [];
        for (let i = 0; i < answer.numRows; i++) {
          read.push({
            table: `${quote(name)}.${quote(String(cell(answer, "table_name", i)))}`,
            column: String(cell(answer, "column_name", i)),
            type: String(cell(answer, "data_type", i)),
          });
        }
        setColumns(read);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSchemaError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [engine, name]);

  const tables = useMemo(() => {
    const byTable = new Map<string, Column[]>();
    for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
    return [...byTable.entries()];
  }, [columns]);

  // A run still out when the view is left is given up.
  useEffect(() => () => running$.current?.abort(), []);

  async function run() {
    const text = sql.trim().replace(/;\s*$/, "");
    if (!text) return;
    if (!READ_ONLY.test(text) || text.includes(";")) {
      setResult(undefined);
      setError("Only one read-only statement can be run: SELECT, WITH, FROM, DESCRIBE, SHOW, SUMMARIZE or EXPLAIN.");
      return;
    }
    running$.current?.abort();
    const controller = new AbortController();
    running$.current = controller;
    setRunning(true);
    setError(undefined);
    const started = performance.now();
    try {
      const answer = await engine.query(text, { signal: controller.signal });
      const names = answer.schema.fields.map((field) => field.name);
      const shown = Math.min(answer.numRows, MAX_ROWS);
      const rows = Array.from({ length: shown }, (_, i) => names.map((n) => format(cell(answer, n, i))));
      setResult({ names, rows, total: answer.numRows, ms: performance.now() - started });
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setResult(undefined);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (running$.current === controller) {
        running$.current = null;
        setRunning(false);
      }
    }
  }

  function cancel() {
    running$.current?.abort();
    running$.current = null;
    setRunning(false);
  }

  return (
    <div className="flex size-full min-h-0">
      <aside aria-label="Tables" className="w-64 shrink-0 overflow-auto border-e p-2 text-xs">
        <p className="mb-2 font-medium text-sm">Tables</p>
        {schemaError && <p className="text-destructive">{schemaError}</p>}
        {tables.map(([table, cols]) => (
          <details className="mb-1" key={table}>
            <summary className="cursor-pointer truncate" title={table}>
              <TableIcon className="me-1 inline size-3" />
              {table.slice(quote(name).length + 1).replace(/^"|"$/g, "")}
            </summary>
            <button
              className="ms-4 text-muted-foreground underline"
              onClick={() => setSql(`SELECT * FROM ${table} LIMIT 100`)}
              type="button"
            >
              Query this table
            </button>
            <ul className="ms-4 mt-1">
              {cols.map((c) => (
                <li className="truncate" key={c.column} title={`${c.column} · ${c.type}`}>
                  {c.column} <span className="text-muted-foreground">{c.type}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-2 border-b p-2">
          <textarea
            aria-label="SQL query"
            className="h-36 w-full resize-y rounded-md border bg-background p-2 font-mono text-sm"
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={`SELECT * FROM ${quote(name)}."CPIProject" LIMIT 20`}
            spellCheck={false}
            value={sql}
          />
          <div className="flex items-center gap-2">
            <Button disabled={running || !sql.trim()} onClick={() => void run()} size="sm">
              <PlayIcon />
              Run
            </Button>
            {running && (
              <Button onClick={cancel} size="sm" variant="ghost">
                <SquareIcon />
                Cancel
              </Button>
            )}
            <span className="text-muted-foreground text-xs">
              {result &&
                `${result.total} ${result.total === 1 ? "row" : "rows"}${result.total > MAX_ROWS ? `, first ${MAX_ROWS} shown` : ""} · ${Math.round(result.ms)} ms`}
              {!result && !running && "Ctrl/Cmd + Enter to run"}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && <pre className="whitespace-pre-wrap p-3 text-destructive text-xs">{error}</pre>}
          {result && !error && (
            <table className="w-max min-w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-card">
                <tr>
                  {result.names.map((n) => (
                    <th className="border-b px-2 py-1 text-start font-medium" key={n}>
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr className="border-b" key={i}>
                    {row.map((value, j) => (
                      <td className="max-w-96 truncate px-2 py-1 align-top" key={j} title={value}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
