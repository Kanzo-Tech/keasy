import "client-only";

import {
  initFossilWasm,
  openProgram,
  providers,
  refs as wasmRefs,
  type FossilProgram,
  type SourceRefInfo,
} from "@fossil-lang/wasm";

import { host } from "./host";

export type { CheckRow, ProviderInfo, SourceRefInfo } from "@fossil-lang/wasm";

let opened: Promise<FossilProgram> | undefined;

/** The job's program, open once per tab: the editor, its introspection and the assistant share it. */
export function jobProgram(): Promise<FossilProgram> {
  opened ??= openProgram("job.fossil", { host });
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
