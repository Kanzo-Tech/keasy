import { FOSSIL_PROMPT } from "./fossil-prompt";
import { type ChatMessage, type CompletionRequest, stripFences } from "./stream";

// ── The assistant: requirements, then a program ─────────────────────────

/** A source file as the browser introspected it. */
export interface FileSchema {
  connection_name: string;
  file_path: string;
  columns: { name: string; data_type: string }[];
}

export interface CompetencyQuestion {
  id: string;
  question: string;
  rationale: string;
}

const SUGGEST_PROMPT = `You are an expert in knowledge graph ontology design and competency questions.

Given a domain description and file schemas (column names and types from CSV files), suggest 5-10 competency questions (CQs) that a knowledge graph built from this data should be able to answer.

Competency questions define the scope of the ontology. They should:
- Be answerable from the provided data columns
- Cover different aspects of the domain
- Range from simple lookups to cross-entity relationships
- Use natural language (not technical jargon)

Return ONLY valid JSON (no markdown fences) with this structure:
{
  "competency_questions": [
    {
      "id": "cq1",
      "question": "What is the full name and email of each person?",
      "rationale": "Maps basic person attributes from the people.csv columns"
    }
  ]
}`;

function describeFiles(schemas: FileSchema[]): string {
  return schemas
    .map((s) => {
      const columns = s.columns.map((c) => `  - ${c.name} (${c.data_type})\n`).join("");
      return `File: @${s.connection_name}/${s.file_path}\nColumns:\n${columns}\n`;
    })
    .join("");
}

function asked(system: string, content: string, max_tokens?: number): CompletionRequest {
  return { system, messages: [{ role: "user", content }], max_tokens };
}

export function suggestRequest(domain: string, schemas: FileSchema[]): CompletionRequest {
  return asked(SUGGEST_PROMPT, `Domain: ${domain}\n\n${describeFiles(schemas)}`);
}

/** The questions the model suggested; none when its answer does not parse. */
export function parseSuggestions(text: string): CompetencyQuestion[] {
  try {
    const parsed = JSON.parse(stripFences(text)) as { competency_questions?: CompetencyQuestion[] };
    return parsed.competency_questions ?? [];
  } catch {
    return [];
  }
}

export function generateRequest(
  domain: string,
  questions: string[],
  schemas: FileSchema[],
): CompletionRequest {
  const listed = questions.map((q, i) => `${i + 1}. ${q}\n`).join("");
  return asked(
    FOSSIL_PROMPT,
    `Domain: ${domain}\n\nCompetency Questions:\n${listed}\nData Schemas:\n${describeFiles(schemas)}`,
  );
}

/** The program the model wrote, out of any fence it put it in. */
export const parseScript = stripFences;

// ── Discovery: a question, a query, a reading ───────────────────────────

/** How many earlier messages of the conversation reach the model. */
const HISTORY_WINDOW = 10;

export interface Plan {
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
A table whose columns are \`"source"\` and \`"target"\` is an edge table,
and its comment names the two vertex tables it connects. Both columns
hold \`"_id"\` values of those tables:
\`\`\`
SELECT t.*
FROM "SourceTable" s
JOIN "EdgeTable" e ON s."_id" = e."source"
JOIN "TargetTable" t ON t."_id" = e."target"
\`\`\`

## DuckDB SQL rules
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
