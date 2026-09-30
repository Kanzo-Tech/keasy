import { type ChatMessage, type CompletionRequest, stripFences } from "@/lib/ai/stream";

/** How many earlier messages of the conversation reach the model. */
const HISTORY_WINDOW = 10;

interface Plan {
  sql: string | null;
  answer: string;
  reasoning: string;
}

/**
 * `schema` is real DuckDB DDL, read by the browser out of its own catalog. The
 * one thing DDL cannot carry is that a join exists at all — the views have no
 * foreign keys — so the prompt keeps the traversal idiom and nothing else.
 */
function queryPrompt(schema: string): string {
  return `You are a DuckDB SQL query assistant operating over a property graph
loaded into DuckDB as views. The schema below is the whole of it: use
those tables and those columns, and invent no others.

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

Return ONLY a JSON object with these three fields:
- "reasoning": which tables/columns you chose and why,
  which values/thresholds you derived from the sample data.
- "sql": a valid DuckDB SQL SELECT query.
- "explanation": one-sentence summary of what the query retrieves.

No markdown fences. No extra text.`;
}

const EXPLAIN_PROMPT = `You are a data analyst. The user will provide:
1. Their original question
2. The SQL query that was executed
3. The query results (first rows as JSON)

Write a concise natural-language summary of the findings in markdown.
Focus on key numbers, patterns, anomalies, and what the data means.
Be specific — reference actual values from the results.
Do NOT return JSON. Do NOT repeat the SQL. Plain markdown only.`;

export function queryRequest(
  schema: string,
  history: ChatMessage[],
  question: string,
  connection?: string,
): CompletionRequest {
  return {
    connection,
    system: queryPrompt(schema),
    messages: [...history.slice(-HISTORY_WINDOW), { role: "user", content: question }],
    max_tokens: 2048,
  };
}

/** The model's plan; its raw text as the answer when that is not the JSON asked for. */
export function parsePlan(text: string): Plan {
  try {
    const parsed = JSON.parse(stripFences(text)) as {
      sql?: string;
      explanation?: string;
      reasoning?: string;
    };
    return {
      sql: parsed.sql ?? null,
      answer: parsed.explanation || "Here is a query for your data.",
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return { sql: null, answer: text.trim(), reasoning: "" };
  }
}

export function explainRequest(
  question: string,
  sql: string,
  rows: string,
  connection?: string,
): CompletionRequest {
  return {
    connection,
    system: EXPLAIN_PROMPT,
    messages: [
      {
        role: "user",
        content: `Original question: ${question}\n\nSQL executed:\n${sql}\n\nResults (showing first rows):\n${rows}`,
      },
    ],
    max_tokens: 512,
  };
}
