"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeftIcon, PlayIcon, SquareIcon, TableIcon } from "lucide-react";
import { Button } from "@kanzo-tech/ui";
import { useAttachedGraph, useJoinGraph } from "@/lib/fossil/graph";

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
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const running$ = useRef<AbortController | null>(null);
  // The table list's width, set by dragging (or the arrow keys on) the bar at its right edge.
  const [asideWidth, setAsideWidth] = useState(320);
  const widthWithin = (w: number) => Math.min(Math.max(w, 192), 800);

  function startResize(down: React.PointerEvent) {
    down.preventDefault();
    const [x, start] = [down.clientX, asideWidth];
    const move = (e: PointerEvent) => setAsideWidth(widthWithin(start + e.clientX - x));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // The graph's schema as the page already holds it: its vertex types and its edges.
  const joins = useJoinGraph();
  const nodes = useMemo(() => joins.types.filter((t) => t.of === undefined), [joins]);
  const relations = joins.edges;
  const tableOf = (table: string) => `${quote(name)}.${quote(table)}`;

  /**
   * Writes the query that follows a relation: its source type, the relation's table and its
   * destination type, joined. GraphAr numbers each vertex within its type (`_graphArVertexIndex`) and
   * an edge table points at its two ends by those numbers, so the edge's columns are read first to
   * find which of them hold the source and the destination.
   */
  async function queryRelation(e: (typeof relations)[number]) {
    try {
      const described = await engine.query(`DESCRIBE ${tableOf(e.name)}`, { signal: new AbortController().signal });
      const names = Array.from({ length: described.numRows }, (_, i) => String(cell(described, "column_name", i)));
      const src = names.find((n) => /src/i.test(n));
      const dst = names.find((n) => /dst/i.test(n));
      if (!src || !dst) {
        setSql(`SELECT * FROM ${tableOf(e.name)} LIMIT 100`);
        return;
      }
      // A readable column of each end: its name when the type has one, its IRI otherwise.
      const shown = (type: string) =>
        nodes.find((n) => n.name === type)?.columns.some((c) => c.name === "name") ? "name" : "subject";
      const to = e.destination === e.source ? `${e.destination} (to)` : e.destination;
      setSql(
        [
          `SELECT o.${quote(shown(e.source))} AS ${quote(e.source)}, d.${quote(shown(e.destination))} AS ${quote(to)}`,
          `FROM ${tableOf(e.source)} o`,
          `JOIN ${tableOf(e.name)} r ON r.${quote(src)} = o."_graphArVertexIndex"`,
          `JOIN ${tableOf(e.destination)} d ON d."_graphArVertexIndex" = r.${quote(dst)}`,
          "LIMIT 100",
        ].join("\n"),
      );
    } catch (err: unknown) {
      setResult(undefined);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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
      <aside aria-label="Tables" className="shrink-0 overflow-auto p-2 text-xs" style={{ width: asideWidth }}>
        <details open>
          <summary className="mb-1 cursor-pointer font-medium text-sm">Nodes ({nodes.length})</summary>
          {nodes.map((t) => (
            <details className="mb-1 ms-2" key={t.name}>
              <summary className="cursor-pointer break-all" title={t.name}>
                <TableIcon className="me-1 inline size-3" />
                {t.name}
                {t.rows !== undefined && <span className="ms-1 text-muted-foreground">{t.rows}</span>}
              </summary>
              <button
                className="ms-4 text-muted-foreground underline"
                onClick={() => setSql(`SELECT * FROM ${tableOf(t.name)} LIMIT 100`)}
                type="button"
              >
                Query this table
              </button>
              <ul className="ms-4 mt-1">
                {t.columns
                  .filter((c) => c.role !== "address")
                  .map((c) => (
                    <li className="break-all" key={c.name} title={`${c.name} · ${c.type}`}>
                      {c.name} <span className="text-muted-foreground">{c.type}</span>
                    </li>
                  ))}
              </ul>
            </details>
          ))}
        </details>
        <details className="mt-2" open>
          <summary className="mb-1 cursor-pointer font-medium text-sm">Relations ({relations.length})</summary>
          {relations.map((e) => (
            <div className="mb-1 ms-2" key={e.name}>
              <p className="break-all" title={e.name}>
                <ArrowRightLeftIcon className="me-1 inline size-3" />
                <span className="font-medium">{e.label ?? e.name}</span>
                {e.rows !== undefined && <span className="ms-1 text-muted-foreground">{e.rows}</span>}
              </p>
              <p className="ms-4 break-all text-muted-foreground" title={`${e.source} → ${e.destination}`}>
                {e.source} → {e.destination}
              </p>
              <button
                className="ms-4 text-muted-foreground underline"
                onClick={() => void queryRelation(e)}
                type="button"
              >
                Query this relation
              </button>
              <button
                className="ms-2 text-muted-foreground underline"
                onClick={() => setSql(`SELECT * FROM ${tableOf(e.name)} LIMIT 100`)}
                type="button"
              >
                Table
              </button>
            </div>
          ))}
        </details>
      </aside>
      <div
        aria-label="Resize the table list"
        aria-orientation="vertical"
        aria-valuemax={800}
        aria-valuemin={192}
        aria-valuenow={asideWidth}
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setAsideWidth((w) => widthWithin(w - 16));
          if (e.key === "ArrowRight") setAsideWidth((w) => widthWithin(w + 16));
        }}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      />

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
            placeholder={nodes[0] ? `SELECT * FROM ${tableOf(nodes[0].name)} LIMIT 20` : "SELECT …"}
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
