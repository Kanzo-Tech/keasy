import { ClientError } from "@/lib/errors";
import type { InferredDescriptor } from "@fossil-lang/introspect";
import { FOSSIL_PROMPT } from "@fossil-lang/prompt";

import { type CompletionRequest, stripFences } from "@/lib/ai/stream";

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

/**
 * The questions the model suggested. An answer that is not the JSON asked for throws
 * `llm/unparseable` with the answer as its detail: it is a failure, never "no suggestions".
 */
export function parseSuggestions(text: string): CompetencyQuestion[] {
  let parsed: { competency_questions?: unknown };
  try {
    parsed = JSON.parse(stripFences(text)) as { competency_questions?: unknown };
  } catch (cause) {
    throw new ClientError("llm/unparseable", "The model's suggestions could not be read", text.trim(), { cause });
  }
  if (!Array.isArray(parsed?.competency_questions)) {
    throw new ClientError("llm/unparseable", "The model's suggestions could not be read", text.trim());
  }
  return parsed.competency_questions as CompetencyQuestion[];
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
