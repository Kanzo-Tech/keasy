/**
 * **The mapping** — docs/design/assistant.md, *The three Tasks*. fossil declares the accepted model —
 * its `vocabularyOf` the types, their IRIs and the sources with their columns, `subjectOf` each
 * type's `@subject` — and its `grammarFor` answers the prelude. The mappings after it are written
 * here, not by a model: one per type and one per edge read across a link file, each field from its
 * column, so there is nothing a model would add but mistakes and tokens. fossil's checker is the
 * proof. The program is the prelude and the mappings; the person never has to read it.
 */

import type { Diagnostic as FossilDiagnostic, Engine, Host, SourceVocabulary, Vocabulary } from "@fossil-lang/types";
import { type FossilProgram, grammarFor, openProgram, subjectOf, vocabularyOf } from "@fossil-lang/wasm";
import type { MappingModel } from "@kanzo-tech/relations";
import { ClientError } from "@/lib/errors";
import { parseMapping } from "@/lib/fossil/rudof";
import type { Accepted } from "./model";
import { delimiterOf, type Profiled } from "./profile";

/** fossil's word on a program: every diagnostic of a check of `program`, the prelude included. */
export type Check = (program: string, signal?: AbortSignal) => Promise<readonly FossilDiagnostic[]>;

/** What the mappings are written from, and what checks them. */
export interface MappingInput {
  accepted: Accepted;
  vocabulary: Vocabulary;
  /** The types declared and the sources bound. */
  prelude: string;
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

/** What the accepted model declares, before any mapping is written: fossil's vocabulary of it, the prelude over that, and each type's `@subject`. */
export type Declared = Pick<MappingInput, "vocabulary" | "prelude" | "subjects">;

/** The accepted model declared by fossil (`vocabularyOf`, `grammarFor`, `subjectOf`), every IRI under `base`. */
export async function declare(accepted: Accepted, profiled: Profiled, { base, signal }: { base: string; signal?: AbortSignal }): Promise<Declared> {
  const vocabulary = await vocabularyOf(accepted, sourcesOf(profiled), base, { signal });
  const [{ prelude }, subjects] = await Promise.all([
    grammarFor(vocabulary, { signal }),
    Promise.all(accepted.types.map(async (t) => [t.name, await subjectOf(t, base, { signal })] as const)),
  ]);
  return { vocabulary, prelude, subjects: Object.fromEntries(subjects) };
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

// ── The mappings ────────────────────────────────────────────────────────────

/** `affiliation` → `Affiliation`: a mapping's name from an edge's. */
const upper = (name: string) => name[0]!.toUpperCase() + name.slice(1);

/**
 * The mappings of `accepted`: one per type — its `@subject`, each field from its column, each edge
 * read on its own file — then one more per edge read across a link file, joined to it on the type's
 * identity, writing again the fields the type requires.
 */
export function mappingsOf({ accepted, subjects }: Pick<MappingInput, "accepted" | "subjects">): string {
  const blocks: string[] = [];
  for (const type of accepted.types) {
    const edges = accepted.edges.filter((e) => e.from === type.name);
    const subject = `    @subject = "${subjects[type.name]}"`;
    const field = (f: { name: string; column: string }) => `    ${f.name} = ${type.source}.${f.column}`;
    const edge = (e: (typeof edges)[number]) => `    ${e.name} = ${e.to}(${e.on}.${e.column})`;
    blocks.push([`${type.name}Rows : ${type.name} from ${type.source}`, subject, ...type.fields.map(field), ...edges.filter((e) => !e.join).map(edge)].join("\n"));
    for (const e of edges.filter((x) => x.join)) {
      const join = `${type.source}.join(${e.on}, on = ${type.source}.${type.identity[0]} == ${e.on}.${e.join!.column})`;
      blocks.push([`${type.name}${upper(e.name)} : ${type.name} from ${join}`, subject, ...type.fields.filter((f) => !f.optional).map(field), edge(e)].join("\n"));
    }
  }
  return blocks.join("\n\n");
}

/** The program for `input`, checked by fossil: an error in it is a fault of `mappingsOf`'s, and thrown. */
export async function writeProgram(input: MappingInput, signal?: AbortSignal): Promise<string> {
  const program = programOf(input, mappingsOf(input));
  const errors = (await input.check(program, signal)).filter((d) => d.severity === 1);
  if (errors.length === 0) return program;
  throw new ClientError(
    "task/unheld",
    "The program written for these files does not compile.",
    errors.map((d) => `Line ${d.range.start.line + 1}: ${d.message}`).join(" "),
  );
}
