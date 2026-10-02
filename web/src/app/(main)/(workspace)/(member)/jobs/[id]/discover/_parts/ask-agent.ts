import type { Coordinator } from "@kanzo-tech/ui/analytics";
import { jsonSchema, stepCountIs, tool, ToolLoopAgent } from "@kanzo-tech/llm";
import { gateway } from "@/lib/ai";
import { type Wire, wireOf } from "@/lib/errors";

/** How much of a result set the model reads; the panel shows all of it. */
const SAMPLE_ROWS = 30;
const SAMPLE_CHARS = 4000;
/** The most rows a query may bring back to the browser: every SELECT says so in its own `LIMIT`. */
export const ROWS = 1000;

/** A 64-bit integer comes back as a `bigint`, which a message cannot carry. */
const plain = (value: unknown) => (typeof value === "bigint" ? Number(value) : value);

/** An answer's rows, plain enough to keep in a message. */
type Row = Record<string, unknown>;

/** The rows the model reads back: the first few, cut to a budget. */
export function sample(rows: readonly Row[]): string {
  const json = JSON.stringify(rows.slice(0, SAMPLE_ROWS));
  return json.length > SAMPLE_CHARS ? `${json.slice(0, SAMPLE_CHARS)}...` : json;
}

/**
 * `schema` is real DuckDB DDL, read by the browser out of its own catalog. The
 * one thing DDL cannot carry is that a join exists at all — the views have no
 * foreign keys — so the instructions keep the traversal idiom and nothing else.
 */
export function askInstructions(schema: string, key: string): string {
  return `You answer questions about a property graph loaded into DuckDB as views, by querying it
with the \`query\` tool and then explaining what the rows say. The schema below is the whole of
it: use those tables and those columns, and invent no others.

## Schema (live, read from DuckDB)

${schema}

## Joining
A table whose comment names two key columns is an edge table: each of those
columns holds the key of the vertex table the comment names beside it.
\`\`\`
SELECT t.*
FROM "SourceTable" s
JOIN "EdgeTable" e ON s."${key}" = e."<its source column>"
JOIN "TargetTable" t ON t."${key}" = e."<its destination column>"
\`\`\`
Every vertex table's \`"${key}"\` is unique across the whole graph, so
include it in a SELECT over vertices: the answer can then be shown on the
graph.

## DuckDB SQL rules
- Name every table exactly as its CREATE TABLE above does, catalog included
  (\`"jobs/7"."Person"\`): an unqualified name matches nothing.
- Always quote identifiers with double quotes: \`"Table"."column"\`.
- Every SELECT ends in a \`LIMIT\` of at most ${ROWS}: default to \`LIMIT 100\`; for top-N use
  \`ORDER BY ... DESC LIMIT N\`.
- Always include readable columns (subject, name, label, title) in SELECT.
- String match: \`"col" ILIKE '%term%'\`. Numeric: \`"col" > N\`, BETWEEN.
- Aggregation: \`SELECT "col", COUNT(*) FROM "Table" GROUP BY "col"\`.
- Date extraction: \`EXTRACT(YEAR FROM "col")\`, \`DATE_TRUNC('month', "col")\`.
- Casts may be required on property columns stored as VARCHAR
  (e.g. \`CAST("elementQuantity" AS DOUBLE) > 0.5\`).

If a query fails, read the error and try again with a corrected one.

## Answering
After the rows come back, answer in concise markdown: the key numbers, patterns and anomalies,
citing actual values. Do not repeat the SQL; the reader can open it.`;
}

/** What a `query` call hands the panel: every row it read. */
export interface QueryOutput {
  readonly sql: string;
  readonly rows: readonly Row[];
}

/** A `query` call's answer: its rows, or the engine's refusal. */
export type QueryAnswer = QueryOutput | { readonly sql: string; readonly refused: Wire };

/**
 * The one tool: run SQL over the graph, here in the browser. The panel keeps the whole result —
 * the table, and the vertices it can show on the canvas — and the model reads a sample.
 */
export function askAgent(schema: string, coordinator: Coordinator, key: string) {
  return new ToolLoopAgent({
    model: gateway("chat"),
    instructions: askInstructions(schema, key),
    stopWhen: stepCountIs(5),
    // Not retried here: the gateway retries its upstreams, and a silent gateway asked three times
    // is three deadlines where the person waits for one.
    maxRetries: 0,
    tools: {
      query: tool({
        description: `Run one DuckDB SQL SELECT over the graph and return its rows. It must end in a LIMIT of at most ${ROWS}.`,
        inputSchema: jsonSchema<{ sql: string }>({
          type: "object",
          properties: { sql: { type: "string", description: `One DuckDB SELECT statement, with a LIMIT of at most ${ROWS}.` } },
          required: ["sql"],
          additionalProperties: false,
        }),
        // A query the engine refuses is an answer, not a throw: the model reads the engine's words
        // and tries again, and the panel shows the refusal as what it is.
        execute: async ({ sql }, { abortSignal }): Promise<QueryAnswer> => {
          try {
            // The coordinator takes no signal: a stopped chat drops the answer when it lands.
            const answer = (await coordinator.query(sql)).toArray() as Row[];
            abortSignal?.throwIfAborted();
            const rows = Array.from(answer, (row) =>
              Object.fromEntries(Object.entries(row).map(([column, value]) => [column, plain(value)])),
            );
            return { sql, rows };
          } catch (err) {
            if (abortSignal?.aborted) throw err;
            return { sql, refused: wireOf(err, "query/failed") };
          }
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value:
            "refused" in output
              ? `The query failed: ${output.refused.detail}`
              : `${output.rows.length} rows. First rows: ${sample(output.rows)}`,
        }),
      }),
    },
  });
}
