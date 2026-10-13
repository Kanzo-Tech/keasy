/**
 * **The `mapping` Task** — docs/design/assistant.md, *The three Tasks*. The accepted model becomes
 * a fossil `Vocabulary` — its types declared, every IRI computed here, and the sources with their
 * columns — and fossil's `grammarFor` answers the prelude and the grammar of what follows it. The
 * model writes the mappings held to that grammar, so it cannot name a column or a field that does
 * not exist; fossil's checker is the oracle for the rest, and its diagnostics go back for a bounded
 * number of repairs. The program is the prelude and the mappings; the person never has to read it.
 */

import type { DeclaredType, Diagnostic as FossilDiagnostic, Engine, Host, Primitive, Vocabulary } from "@fossil-lang/types";
import { type FossilProgram, grammarFor, openProgram } from "@fossil-lang/wasm";
import { defineTask, type Finding } from "@kanzo-tech/ai/task";
import type { Accepted, AcceptedEdge, AcceptedType } from "./model";
import { delimiterOf, type Profiled } from "./profile";
import { plural, spoken } from "./words";

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

const FOSSIL_TYPE: Record<Primitive, string> = {
  string: "String",
  integer: "Integer",
  float: "Float",
  bool: "Bool",
  date: "Date",
  date_time: "DateTime",
  time: "Time",
  g_year: "GYear",
  any_uri: "AnyUri",
};

/** `https://acme.example/` → the IRIs of a workspace's vocabulary and of its things, under it. */
export function irisOf(base: string) {
  const root = base.endsWith("/") ? base : `${base}/`;
  return {
    type: (name: string) => `${root}vocab/${name}`,
    field: (name: string) => `${root}vocab/${name}`,
    thing: (name: string) => `${root}id/${spoken(name).replace(/ /g, "-")}/`,
  };
}

/** An edge's declared type: `Ref<T>`, `Option<Ref<T>>` where some have none, `Seq<Ref<T>>` across a link. */
const edgeType = (e: AcceptedEdge) => (e.many ? `Seq<Ref<${e.to}>>` : e.optional ? `Option<Ref<${e.to}>>` : `Ref<${e.to}>`);

/** The vocabulary of the accepted model over the profiled sources, every IRI under `base`. */
export function vocabularyOf(accepted: Accepted, profiled: Profiled, base: string): Vocabulary {
  const iri = irisOf(base);
  const declared: DeclaredType[] = accepted.types.map((t) => ({
    name: t.name,
    iri: iri.type(t.name),
    fields: [
      ...t.fields.map((f) => {
        const type = FOSSIL_TYPE[f.primitive];
        return { name: f.name, iri: iri.field(f.name), type: f.optional ? `Option<${type}>` : type };
      }),
      ...accepted.edges.filter((e) => e.from === t.name).map((e) => ({ name: e.name, iri: iri.field(e.name), type: edgeType(e) })),
    ],
  }));
  const used = new Set([...accepted.types.map((t) => t.source), ...accepted.edges.map((e) => e.on)]);
  const sources = profiled.sources
    .filter((s) => used.has(s.name))
    .map((s) => {
      const delimiter = delimiterOf(s.option);
      return { name: s.name, format: s.format, reference: s.key, columns: s.columns.map((c) => c.name), ...(delimiter ? { delimiter } : {}) };
    });
  return { declared, sources };
}

/** A type's `@subject`: its IRI prefix and its identity's columns. */
export function subjectOf(type: AcceptedType, base: string): string {
  return `${irisOf(base).thing(type.name)}${type.identity.map((c) => `{${type.source}.${c}}`).join("-")}`;
}

/**
 * The request, computed: the vocabulary, fossil's prelude and grammar for it, and each type's
 * subject. `check` is fossil's checker, which a test hands an engine double.
 */
export async function mappingInput(
  accepted: Accepted,
  profiled: Profiled,
  { base, check, signal }: { base: string; check: Check; signal?: AbortSignal },
): Promise<MappingInput> {
  const vocabulary = vocabularyOf(accepted, profiled, base);
  const { prelude, grammar } = await grammarFor(vocabulary, { signal });
  const subjects = Object.fromEntries(accepted.types.map((t) => [t.name, subjectOf(t, base)]));
  return { accepted, vocabulary, prelude, grammar, subjects, check };
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
    `${plural(type.name)} : ${type.name} from ${type.source}`,
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
