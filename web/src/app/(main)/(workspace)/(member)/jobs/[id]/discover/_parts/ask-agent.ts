import type { SqlCorpus, SqlResult } from "@fossil-lang/corpus";
import { jsonSchema, stepCountIs, tool, ToolLoopAgent } from "@kanzo-tech/llm";
import { gateway } from "@/lib/ai";
import { type Shown, toProblem } from "@/lib/errors";
import { recordsOf } from "./corpus";

/** How much of a result set the model reads; the panel shows all of it. */
const SAMPLE_ROWS = 30;
const SAMPLE_CHARS = 4000;
/** The most rows a query brings back to the browser. */
const ROWS = 1000;

/** A 64-bit integer comes back as a `bigint`, which a message cannot carry. */
const plain = (value: unknown) => (typeof value === "bigint" ? Number(value) : value);

/** The rows the model reads back: the first few, as records, cut to a budget. */
export function sample(result: SqlResult): string {
  const json = JSON.stringify(recordsOf({ ...result, rows: result.rows.slice(0, SAMPLE_ROWS) }));
  return json.length > SAMPLE_CHARS ? `${json.slice(0, SAMPLE_CHARS)}...` : json;
}

/**
 * `schema` is real DuckDB DDL, read by the browser out of its own catalog. The
 * one thing DDL cannot carry is that a join exists at all — the views have no
 * foreign keys — so the instructions keep the traversal idiom and nothing else.
 */
export function askInstructions(schema: string): string {
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
JOIN "EdgeTable" e ON s."dense_id" = e."src"
JOIN "TargetTable" t ON t."dense_id" = e."dst"
\`\`\`
Every vertex table's \`"dense_id"\` is unique across the whole graph, so
include it in a SELECT over vertices: the answer can then be shown on the
graph.

## DuckDB SQL rules
- Name every table exactly as its CREATE TABLE above does, catalog included
  (\`"jobs/7"."Person"\`): an unqualified name matches nothing.
- Always quote identifiers with double quotes: \`"Table"."column"\`.
- Default to \`LIMIT 100\`; for top-N use \`ORDER BY ... DESC LIMIT N\`.
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

/** What a `query` call hands the panel: every row it read, plain enough to keep in a message. */
export type QueryOutput = SqlResult & { readonly sql: string };

/** A `query` call's answer: its rows, or the engine's refusal. */
export type QueryAnswer = QueryOutput | { readonly sql: string; readonly refused: Shown };

/**
 * The one tool: run SQL over the graph, here in the browser. The panel keeps the whole result —
 * the table, and the vertices it can show on the canvas — and the model reads a sample.
 */
export function askAgent(schema: string, corpus: SqlCorpus) {
  return new ToolLoopAgent({
    model: gateway("chat"),
    instructions: askInstructions(schema),
    stopWhen: stepCountIs(5),
    // Not retried here: the gateway retries its upstreams, and a silent gateway asked three times
    // is three deadlines where the person waits for one.
    maxRetries: 0,
    tools: {
      query: tool({
        description: "Run one DuckDB SQL SELECT over the graph and return its rows.",
        inputSchema: jsonSchema<{ sql: string }>({
          type: "object",
          properties: { sql: { type: "string", description: "One DuckDB SELECT statement." } },
          required: ["sql"],
          additionalProperties: false,
        }),
        // A query the engine refuses is an answer, not a throw: the model reads the engine's words
        // and tries again, and the panel shows the refusal as what it is.
        execute: async ({ sql }, { abortSignal }): Promise<QueryAnswer> => {
          try {
            const result = await corpus.sql(sql, { limit: ROWS, signal: abortSignal });
            return { sql, ...result, rows: result.rows.map((row) => row.map(plain)) };
          } catch (err) {
            if (abortSignal?.aborted) throw err;
            return { sql, refused: toProblem(err, "query/failed") };
          }
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value:
            "refused" in output
              ? `The query failed: ${output.refused.detail}`
              : `${output.rows.length}${output.truncated ? "+" : ""} rows. First rows: ${sample(output)}`,
        }),
      }),
    },
  });
}
