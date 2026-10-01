import type { InferredDescriptor } from "@fossil-lang/introspect";
import { FOSSIL_PROMPT } from "@fossil-lang/prompt";

import { jsonSchema, Output, streamText } from "@kanzo-tech/llm";
import { gateway } from "@/lib/ai";

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

Each comes with a one-sentence rationale naming the columns it rests on.`;

/** Fossil's surface, plus how keasy's connections are named and what the answer must be. */
const PROGRAM_PROMPT = `${FOSSIL_PROMPT}

## Rules

1. Open the program with exactly one \`type { … } := io.shex("@connection_name/<name>.shex")\` binding, naming a shape document that sits in the same connection as the data. Every shape you map to, and every property key you write, must be one that document declares — pick the connection of the files you were given and a \`.shex\` name that matches the domain.
2. Reference every file as \`@connection_name/path\` inside a quoted string; never a bare path.
3. Model distinct entities as distinct shapes and distinct mappings, not one mega-shape.
4. Relate entities with an edge — a call of the destination shape, \`Shape(<key expression>)\` — where the key expression builds the same identity that shape's own mapping declares.
5. Give every mapping an \`@subject\` whose template incorporates a row value that is unique.
6. Map all the source columns the competency questions need, and no columns that do not exist in the schemas given.`;

/** The files the program will read, as the model is shown them — also the context of the Domain field. */
export function describeFiles(sources: readonly InferredDescriptor[]): string {
  return sources
    .map((s) => {
      const columns = s.columns.map((c) => `  - ${c.name} (${c.primitive})\n`).join("");
      return `File: ${s.uri}\nColumns:\n${columns}\n`;
    })
    .join("");
}

const QUESTION = jsonSchema<{ question: string; rationale: string }>({
  type: "object",
  properties: { question: { type: "string" }, rationale: { type: "string" } },
  required: ["question", "rationale"],
  additionalProperties: false,
});

/** Competency questions for the data, each arriving as soon as it is whole. */
export function suggestQuestions(domain: string, schemas: readonly InferredDescriptor[], signal: AbortSignal) {
  return streamText({
    model: gateway("chat"),
    system: SUGGEST_PROMPT,
    prompt: `Domain: ${domain}\n\n${describeFiles(schemas)}`,
    output: Output.array({ element: QUESTION }),
    abortSignal: signal,
  }).elementStream;
}

const PROGRAM = jsonSchema<{ program: string }>({
  type: "object",
  properties: { program: { type: "string", description: "The whole Fossil program." } },
  required: ["program"],
  additionalProperties: false,
});

/** The program, as it is written: each partial object carries the text so far. */
export function writeProgram(
  domain: string,
  questions: string[],
  schemas: readonly InferredDescriptor[],
  signal: AbortSignal,
) {
  const listed = questions.map((q, i) => `${i + 1}. ${q}\n`).join("");
  return streamText({
    model: gateway("chat"),
    system: PROGRAM_PROMPT,
    prompt: `Domain: ${domain}\n\nCompetency Questions:\n${listed}\nData Schemas:\n${describeFiles(schemas)}`,
    output: Output.object({ schema: PROGRAM }),
    abortSignal: signal,
  }).partialOutputStream;
}
