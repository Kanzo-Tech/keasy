/**
 * **The mapping** — docs/design/assistant.md, *The three Tasks*. The program is fossil's: `write`
 * makes it of the model — the types declared under the workspace's IRIs, the sources bound, one
 * mapping per type and one more per relation read across a link file — so there is nothing a model
 * would add but mistakes and tokens. fossil's checker is the proof. The person never has to read it.
 */

import type { Diagnostic as FossilDiagnostic, Engine, Host, Model } from "@fossil-lang/types";
import { type FossilProgram, open, write } from "@fossil-lang/wasm";
import type { MappingModel } from "@kanzo-tech/relations";
import { ClientError } from "@/lib/errors";
import { parseMapping } from "@/lib/fossil/rudof";

/** fossil's word on a program: every diagnostic of a check of `program`. */
export type Check = (program: string, signal?: AbortSignal) => Promise<readonly FossilDiagnostic[]>;

/**
 * The RML mapping fossil makes of `program`'s types — the `mapping.ttl` a run will write beside the
 * graph, before any run — as rudof models it: what `withMapping` describes a join graph by.
 */
export async function mappingOf(program: string, { host, signal }: { host: Host; signal?: AbortSignal }): Promise<MappingModel> {
  const opened = await open("written.fossil", { host, text: program, signal });
  try {
    return (await parseMapping(await opened.mapping())).model();
  } finally {
    opened.close();
  }
}

/**
 * fossil's checker over the page's engine: one program, opened on the first check and described
 * once — the sources do not change between models — then each check is an update. `close` frees it.
 */
export function fossilCheck({ host, engine, uri = "assistant.fossil" }: { host: Host; engine: Engine; uri?: string }): Check & { close: () => void } {
  let opened: Promise<FossilProgram> | undefined;
  const opening = (program: string, signal?: AbortSignal) => {
    const pending = open(uri, { host, text: program, signal }).then(async (p) => {
      await p.describe({ engine, options: { depth: "types" }, signal });
      return p;
    });
    opened = pending;
    // A failed open is forgotten, so the next check opens again rather than inherit it.
    pending.catch(() => {
      if (opened === pending) opened = undefined;
    });
    return pending;
  };
  const check = async (program: string, signal?: AbortSignal) => {
    const p = await (opened ?? opening(program, signal));
    p.update(program);
    return (await p.diagnostics()).filter((d) => d.uri === uri);
  };
  return Object.assign(check, { close: () => void opened?.then((p) => p.close(), () => undefined) });
}

/**
 * The program `model` implies, every IRI under `base`, checked by fossil: an error in it is fossil's
 * `write` and its `infer` disagreeing with the checker, and thrown.
 */
export async function writeProgram(model: Model, { base, check, signal }: { base: string; check: Check; signal?: AbortSignal }): Promise<string> {
  const program = await write(model, { base, signal });
  const errors = (await check(program, signal)).filter((d) => d.severity === 1);
  if (errors.length === 0) return program;
  throw new ClientError(
    "task/unheld",
    "The program written for these files does not compile.",
    errors.map((d) => `Line ${d.range.start.line + 1}: ${d.message}`).join(" "),
  );
}
