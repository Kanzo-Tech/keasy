/**
 * **The `mapping` Task** — docs/design/assistant.md, *The three Tasks*. fossil declares the accepted
 * model — its `vocabularyOf` the types, their IRIs and the sources with their columns, `subjectOf`
 * each type's `@subject` — and its `grammarFor` answers the prelude and the grammar of what follows it. The
 * model writes the mappings held to that grammar, so it cannot name a column or a field that does
 * not exist; fossil's checker is the oracle for the rest, and its diagnostics go back for a bounded
 * number of repairs. The program is the prelude and the mappings; the person never has to read it.
 */

import type { Diagnostic as FossilDiagnostic, Engine, Host, SourceVocabulary, Vocabulary } from "@fossil-lang/types";
import { type FossilProgram, grammarFor, openProgram, subjectOf, vocabularyOf } from "@fossil-lang/wasm";
import { defineTask, type Finding } from "@kanzo-tech/ai/task";
import type { MappingModel } from "@kanzo-tech/relations";
import { parseMapping } from "@/lib/fossil/rudof";
import type { Accepted, AcceptedType } from "./model";
import { delimiterOf, type Profiled } from "./profile";

/** fossil's word on a program: every diagnostic of a check of `program`, the prelude included. */
export type Check = (program: string, signal?: AbortSignal) => Promise<readonly FossilDiagnostic[]>;

/** What the model writes after the prelude, and what checks it. */
export interface MappingInput {
  accepted: Accepted;
  vocabulary: Vocabulary;
  /** The types declared and the sources bound: the request's, never the model's. */
  prelude: string;
  /** The EBNF every token of the mappings is held to. */
  grammar: string;
  /** Each type's `@subject`, as keasy computes it. */
  subjects: Readonly<Record<string, string>>;
  check: Check;
}

/** The profiled sources as fossil's vocabulary names them: each binding, its format, its reference and its columns. */
function sourcesOf(profiled: Profiled): SourceVocabulary[] {
  return profiled.sources.map((s) => {
    const delimiter = delimiterOf(s.option);
    return { name: s.name, format: s.format, reference: s.key, columns: s.columns.map((c) => c.name), ...(delimiter ? { delimiter } : {}) };
  });
}

/** What the accepted model declares, before any mapping is written: fossil's vocabulary of it, the prelude and grammar over that, and each type's `@subject`. */
export type Declared = Pick<MappingInput, "vocabulary" | "prelude" | "grammar" | "subjects">;

/** The accepted model declared by fossil (`vocabularyOf`, `grammarFor`, `subjectOf`), every IRI under `base`. */
export async function declare(accepted: Accepted, profiled: Profiled, { base, signal }: { base: string; signal?: AbortSignal }): Promise<Declared> {
  const vocabulary = await vocabularyOf(accepted, sourcesOf(profiled), base, { signal });
  const [{ prelude, grammar }, subjects] = await Promise.all([
    grammarFor(vocabulary, { signal }),
    Promise.all(accepted.types.map(async (t) => [t.name, await subjectOf(t, base, { signal })] as const)),
  ]);
  return { vocabulary, prelude, grammar, subjects: Object.fromEntries(subjects) };
}

/**
 * The RML mapping fossil makes of `prelude`'s types — the `mapping.ttl` a run will write beside the
 * graph, before any run — as rudof models it: what `withMapping` describes a join graph by.
 */
export async function mappingOf(prelude: string, { host, signal }: { host: Host; signal?: AbortSignal }): Promise<MappingModel> {
  const program = await openProgram("declared.fossil", { host, text: prelude, signal });
  try {
    return (await parseMapping(await program.mapping())).model();
  } finally {
    program.close();
  }
}

/** The whole program: the prelude, then the mappings. */
export const programOf = (input: Pick<MappingInput, "prelude">, mappings: string) => `${input.prelude}\n${mappings.trimEnd()}\n`;

/**
 * fossil's checker over the page's engine: one program, opened on the first check and described
 * once — the prelude, and with it the sources, does not change between attempts — then each attempt
 * is an update and a check. `close` frees it.
 */
export function fossilCheck({ host, engine, uri = "assistant.fossil" }: { host: Host; engine: Engine; uri?: string }): Check & { close: () => void } {
  let opened: Promise<FossilProgram> | undefined;
  const open = (program: string, signal?: AbortSignal) => {
    const opening = openProgram(uri, { host, text: program, signal }).then(async (p) => {
      await p.describe({ engine, options: { depth: "types" }, signal });
      return p;
    });
    opened = opening;
    // A failed open is forgotten, so the next attempt opens again rather than inherit it.
    opening.catch(() => {
      if (opened === opening) opened = undefined;
    });
    return opening;
  };
  const check = async (program: string, signal?: AbortSignal) => {
    const p = await (opened ?? open(program, signal));
    p.update(program);
    return (await p.diagnostics()).filter((d) => d.uri === uri);
  };
  return Object.assign(check, { close: () => void opened?.then((p) => p.close(), () => undefined) });
}

// ── The oracles ─────────────────────────────────────────────────────────────

/** `Name : Type from …` headers, each with its body's lines. */
function mappingsIn(text: string) {
  const out: { type: string; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const header = line.match(/^[A-Z][A-Za-z0-9_]* : ([A-Z][A-Za-z0-9_]*) from /);
    if (header) out.push({ type: header[1]!, lines: [] });
    else if (line.startsWith("    ")) out.at(-1)?.lines.push(line.trim());
  }
  return out;
}

/** Every type has a mapping, and every edge is written by a mapping of the type it leaves. */
function covers(text: string, input: MappingInput): Finding[] {
  const mappings = mappingsIn(text);
  const unmapped = input.accepted.types.filter((t) => !mappings.some((m) => m.type === t.name));
  const unwritten = input.accepted.edges.filter((e) => !mappings.some((m) => m.type === e.from && m.lines.some((l) => l.startsWith(`${e.name} = `))));
  return [
    ...unmapped.map((t) => ({ code: "mapping/unmapped", message: `${t.name} has no mapping: write one, \`… : ${t.name} from ${t.source}\`.` })),
    ...unwritten.map((e) => ({ code: "mapping/missing-edge", message: `${e.from}.${e.name} is written by no mapping of ${e.from}.` })),
  ];
}

/** Each mapping's `@subject` is the one keasy computed for its type. */
function subjects(text: string, input: MappingInput): Finding[] {
  return mappingsIn(text).flatMap(({ type, lines }) => {
    const expected = input.subjects[type];
    const written = lines.find((l) => l.startsWith("@subject = "));
    return expected === undefined || written === `@subject = "${expected}"`
      ? []
      : [{ code: "mapping/subject", message: `${type}: its @subject is "${expected}", exactly.` }];
  });
}

/** fossil's errors on the whole program, each at its line among the mappings. */
async function compiles(text: string, input: MappingInput): Promise<Finding[]> {
  const offset = input.prelude.split("\n").length;
  const rows = await input.check(programOf(input, text));
  return rows
    .filter((d) => d.severity === 1)
    .map((d) => {
      const line = d.range.start.line - offset + 1;
      return { code: `mapping/${d.code}`, message: `${line > 0 ? `line ${line}` : "the prelude"}: ${d.message}${d.help ? ` (${d.help})` : ""}` };
    });
}

// ── The Task ────────────────────────────────────────────────────────────────

const MAPPING = `You write the mappings of a Fossil program: how each row of a file becomes a thing of a type.
The types and the files are declared above; write one mapping per type, then one more for each edge read across another file, a blank line between two.
Write each @subject exactly as given, and each field from the column given.`;

/** What one type's mappings read: its subject, its fields' columns, and each edge's. */
function planOf(type: AcceptedType, input: MappingInput): string {
  const edges = input.accepted.edges.filter((e) => e.from === type.name);
  const required = type.fields.filter((f) => !f.optional).map((f) => `${f.name} = ${type.source}.${f.column}`);
  const lines = [
    `${type.name}Rows : ${type.name} from ${type.source}`,
    `  @subject = "${input.subjects[type.name]}"`,
    ...type.fields.map((f) => `  ${f.name} from ${type.source}.${f.column}`),
    ...edges.filter((e) => !e.join).map((e) => `  ${e.name} = ${e.to}(${e.on}.${e.column})`),
  ];
  for (const e of edges.filter((x) => x.join)) {
    lines.push(
      `and, for ${e.name}, a mapping of ${type.name} from ${type.source}.join(${e.on}, on = ${type.source}.${type.identity[0]} == ${e.on}.${e.join!.column}), with the same @subject${required.length > 0 ? `, ${required.join(", ")}` : ""} and ${e.name} = ${e.to}(${e.on}.${e.column})`,
    );
  }
  return lines.join("\n");
}

/** The mapping Task: the model's mappings, held to fossil's grammar and checked by fossil. */
export const mapping = defineTask<MappingInput, string, MappingInput>({
  name: "mapping",
  context: (input) => input,
  instructions: MAPPING,
  prompt: (input) =>
    [
      "The program so far:",
      input.prelude,
      "Write the mappings:",
      ...input.accepted.types.map((t) => planOf(t, input)),
    ].join("\n"),
  grammar: (input) => input.grammar,
  target: () => ({ set: "" }),
  verify: [covers, subjects, compiles],
  attempts: 3,
});
