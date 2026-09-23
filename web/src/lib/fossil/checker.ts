"use client";

/**
 * The checker, on the main thread — keasy's bridge to `@fossil-lang/wasm`.
 *
 * There is no Worker and no LSP any more. `@fossil-lang/codemirror-fossil`'s
 * `fossil()` takes plain callbacks, so the whole of the editor's intelligence —
 * highlighting, squiggles, hover, completion, go-to-definition — is a function
 * call into `FossilPlayground` in this tab. What used to be a worker entry, a
 * `WorkerTransport`, a JSON-RPC dispatch and a SECOND wasm instantiation for the
 * tokenizer is this module.
 *
 * `FossilPlayground` is a workspace, not a compiler: it holds the open buffer and
 * re-checks it, because an editor edits. keasy opens exactly one — the job's
 * program — and every consumer below answers about the text of the last
 * `updateFile`, which is why {@link sync} exists and why every entry point takes
 * the text rather than only a position.
 *
 * Mirrors `rmlext/apps/playground/src/check.ts`, the reference call site.
 */

import {
  FossilPlayground,
  initFossilWasm,
  providers as wasmProviders,
  refs as wasmRefs,
  type CheckRow,
  type CompletionRow,
  type DefinitionRow,
  type FileHandle,
  type HoverRow,
  type InferredDescriptorJson,
  type ProviderInfo,
  type SourceRefInfo,
} from "@fossil-lang/wasm";

export type { CheckRow, CompletionRow, DefinitionRow, HoverRow, ProviderInfo, SourceRefInfo };
export { tokenize, tokenKinds } from "@fossil-lang/wasm";

// Staged into public/ by scripts/copy-fossil-wasm.mjs (predev/prebuild). One
// artefact, one instantiation, one workspace — `initFossilWasm` is memoised, so
// the awaits scattered below are free after the first.
const WASM_URL = "/fossil/fossil_wasm_bg.wasm";

/** The key the job's program is open under. `CheckRow.uri` carries it, and
 *  `fossil()` drops rows belonging to any other buffer. */
export const PROGRAM_URI = "job.fossil";

let booting: Promise<void> | null = null;
let playground: FossilPlayground | null = null;
let handle: FileHandle | null = null;
/** The text last pushed into the workspace. See {@link sync}. */
let pushed: string | null = null;

/** Instantiate the module and open the program buffer. Idempotent. */
export function load(): Promise<void> {
  booting ??= (async () => {
    await initFossilWasm({ wasmUrl: WASM_URL });
    playground = new FossilPlayground();
    handle = playground.openFile(PROGRAM_URI, "");
    pushed = "";
  })();
  return booting;
}

/**
 * Push the buffer into the workspace, unless it is already there.
 *
 * Four callers at four rates share one workspace. The linter runs on a debounce;
 * hover fires when the pointer rests; completion fires on nearly every keystroke.
 * All four answer about the text of the last `updateFile`, so all four push
 * first — otherwise a hover range lands one keystroke wrong, which reads as an
 * editor bug rather than as staleness.
 *
 * The string comparison is what makes that cheap: `updateFile` is the one call
 * that bumps the Salsa revision, so calling it per mouse-move would invalidate
 * the memoised check the squiggles came from for nothing.
 */
function sync(text: string): void {
  if (!playground || handle === null || text === pushed) return;
  playground.updateFile(handle, text);
  pushed = text;
}

/** Re-check after an edit — the `didChange` path, and the same Salsa setter.
 *  No debounce here: `fossil()`'s linter waits out its own delay AND waits for
 *  this to return before scheduling again. */
export function checkText(program: string): CheckRow[] {
  if (!playground || handle === null) return [];
  sync(program);
  return playground.check();
}

/** Check without editing — used after a descriptor lands. */
export function check(): CheckRow[] {
  return playground?.check() ?? [];
}

/** The type under the cursor, and the type the target shape demands of it. */
export function hoverAt(text: string, line: number, character: number): HoverRow | null {
  if (!playground || handle === null) return null;
  sync(text);
  return playground.hover(handle, line, character);
}

/** The candidates at the cursor, narrowed by the receiver's type. */
export function completeAt(text: string, line: number, character: number): CompletionRow[] {
  if (!playground || handle === null) return [];
  sync(text);
  return playground.completions(handle, line, character);
}

/** Where the name under the cursor is defined. */
export function definitionAt(text: string, line: number, character: number): DefinitionRow[] {
  if (!playground || handle === null) return [];
  sync(text);
  return playground.gotoDefinition(handle, line, character);
}

/**
 * Push a host-introspected input schema at the compiler, BEFORE the next check.
 *
 * The compiler performs no IO, so a source's columns are the host's to supply:
 * `use-source-descriptors.ts` runs the DESCRIBE through keasy's server (which
 * holds the org's credentials) and the answer arrives here. Registering used to
 * be `<FossilEditor descriptors={…}/>`'s job over `fossil/registerInferredDescriptor`;
 * without the worker it is a method call, which is what it always was on the
 * other side of the wire.
 */
export function registerDescriptor(descriptor: InferredDescriptorJson): void {
  playground?.registerInferredDescriptor(descriptor);
}

/**
 * A program's typed lineage — every external reference (`@conn` data + `schema =`),
 * each tagged with its alias and role. The SAME parse the native `fossil refs`
 * runs, so the browser and the CLI never diverge.
 */
export async function refs(program: string): Promise<SourceRefInfo[]> {
  await load();
  return wasmRefs(program);
}

/** The data-source providers fossil supports (`io.csv`, `io.rdf`, …). */
export async function providers(): Promise<ProviderInfo[]> {
  await load();
  return wasmProviders();
}

/** LSP severity 1 is an error; 2 a warning. A program with no 1s is runnable. */
export function hasErrors(rows: readonly CheckRow[]): boolean {
  return rows.some((row) => row.severity === 1);
}
