import "client-only";

import {
  initFossilWasm,
  openProgram,
  providers,
  refs as wasmRefs,
  type FossilProgram,
  type SourceRefInfo,
} from "@fossil-lang/wasm";

import { type CheckRow, FossilError, isFossilError, until } from "@fossil-lang/types";

import { host } from "./host";

export type { CheckRow, ProviderInfo, SourceRefInfo } from "@fossil-lang/wasm";

/** The key the job's program is open under: every `CheckRow.uri` about it. */
export const JOB_URI = "job.fossil";

let opened: Promise<FossilProgram> | undefined;

/**
 * The job's program, open once per tab: the editor, its introspection and the assistant share it.
 * A failed open is forgotten, so the next call tries again rather than every caller inheriting one
 * transient failure until the tab reloads. The open is shared, so a caller's `signal` ends only its
 * own wait, never the open the others are waiting on.
 */
export function jobProgram({ signal }: { signal?: AbortSignal } = {}): Promise<FossilProgram> {
  return until(opening(), signal);
}

function opening(): Promise<FossilProgram> {
  if (opened === undefined) {
    const opening = openProgram(JOB_URI, { host });
    opened = opening;
    opening.catch(() => {
      // The caller that awaited it sees the failure; this only clears the cache for the next one.
      if (opened === opening) opened = undefined;
    });
  }
  return opened;
}

/** A program's external references, each with its alias and role — the parse `fossil refs` runs. */
export async function refs(program: string): Promise<SourceRefInfo[]> {
  await initFossilWasm();
  return wasmRefs(program);
}

/** Compiled into the module, so they never go stale. */
export const providersQuery = {
  queryKey: ["fossil", "providers"],
  queryFn: async () => {
    await initFossilWasm();
    return providers();
  },
  staleTime: Infinity,
} as const;

/**
 * A check that never answered — the program could not be opened, or `check` threw — as the one row
 * the studio counts. It is the row `@fossil-lang/codemirror-fossil`'s linter draws for the same
 * failure: on the first character, by its code, and `internal/bug` when fossil did not raise it.
 * So the badge and the editor say the same thing, and a program nobody could check is not "Valid".
 */
export function uncheckedRow(cause: unknown): CheckRow {
  const { problem } = isFossilError(cause)
    ? cause
    : FossilError.of("internal/bug", { what: "the check failed outside fossil" }, { cause });
  return {
    uri: JOB_URI,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: 1,
    code: problem.code,
    title: problem.title,
    message: problem.detail,
    help: problem.help,
    data: problem.data,
  } as CheckRow;
}
