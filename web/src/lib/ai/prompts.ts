import type { InferredDescriptor } from "@fossil-lang/introspect";
import { FOSSIL_PROMPT } from "@fossil-lang/prompt";

import { type ChatMessage, type CompletionRequest, stripFences } from "./stream";

// ── The assistant: requirements, then a program ─────────────────────────

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

/** Fossil's surface, plus how keasy's connections are named and what the answer must be. */
const PROGRAM_PROMPT = `${FOSSIL_PROMPT}

## Rules

1. Open the program with exactly one \`type { … } := io.shex("@connection_name/<name>.shex")\` binding, naming a shape document that sits in the same connection as the data. Every shape you map to, and every property key you write, must be one that document declares — pick the connection of the files you were given and a \`.shex\` name that matches the domain.
2. Reference every file as \`@connection_name/path\` inside a quoted string; never a bare path.
3. Model distinct entities as distinct shapes and distinct mappings, not one mega-shape.
4. Relate entities with an edge — a call of the destination shape, \`Shape(<key expression>)\` — where the key expression builds the same identity that shape's own mapping declares.
5. Give every mapping an \`@subject\` whose template incorporates a row value that is unique.
6. Map all the source columns the competency questions need, and no columns that do not exist in the schemas given.
7. Return ONLY the Fossil program: no JSON, no markdown fences, no commentary.`;

function describeFiles(sources: readonly InferredDescriptor[]): string {
  return sources
    .map((s) => {
      const columns = s.columns.map((c) => `  - ${c.name} (${c.primitive})\n`).join("");
      return `File: ${s.uri}\nColumns:\n${columns}\n`;
    })
    .join("");
}

function asked(system: string, content: string, max_tokens?: number): CompletionRequest {
  return { system, messages: [{ role: "user", content }], max_tokens };
}

export function suggestRequest(domain: string, schemas: readonly InferredDescriptor[]): CompletionRequest {
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
  schemas: readonly InferredDescriptor[],
): CompletionRequest {
  const listed = questions.map((q, i) => `${i + 1}. ${q}\n`).join("");
  return asked(
    PROGRAM_PROMPT,
    `Domain: ${domain}\n\nCompetency Questions:\n${listed}\nData Schemas:\n${describeFiles(schemas)}`,
  );
}

/** The program the model wrote, out of any fence it put it in. */
export const parseScript = stripFences;

// ── Discovery: a question, a query, a reading ───────────────────────────

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
