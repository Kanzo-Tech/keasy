import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

import { runToCompletion } from "./fixtures";
import { api } from "./stack/api";

/**
 * The dev examples `make seed` fetches, one folder each under infra/dev/examples/, and the program
 * that maps each one (`mapping.fossil`) — read from the tree, never retyped, so a new example is
 * a new folder and nothing here.
 */
const EXAMPLES_DIR = fileURLToPath(new URL("../../infra/dev/examples/", import.meta.url));

/** The examples' names: every folder under infra/dev/examples/ with a `mapping.fossil`. */
export const EXAMPLES: readonly string[] = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(EXAMPLES_DIR, entry.name, "mapping.fossil")))
  .map((entry) => entry.name)
  .sort();

/**
 * A dev example by its folder's name (`"snb"`, `"openflights"`, …). A string rather than a union,
 * as the folders are what list them: an unknown name fails at once, naming the ones there are.
 */
export type Example = string;

/** A file of the dev example `example`, by its name in the example's folder. */
function read(example: Example, file: string): string {
  if (!EXAMPLES.includes(example)) {
    throw new Error(`no dev example "${example}" under infra/dev/examples/ (there are: ${EXAMPLES.join(", ")})`);
  }
  return readFileSync(join(EXAMPLES_DIR, example, file), "utf8");
}

/** The program that maps the dev example `example`. */
export function mapping(example: Example): string {
  return read(example, "mapping.fossil");
}

/** The rules the dev example `example` is checked against (`rules.ttl`, SHACL), as the rules' badge takes them. */
export function rules(example: Example): string {
  return read(example, "rules.ttl");
}

/** Whether the dev example `example` is in this tree: a demo of an example still on its way skips. */
export function hasExample(example: Example): boolean {
  return EXAMPLES.includes(example);
}

/**
 * A graph of the dev example `example`, named `name`, run to completion by the browser on `page`
 * (which must be signed in), within `within` ms. With `reuse`, a completed graph already named
 * `name` is returned instead of running another — a demo recorded twice runs its graph once.
 */
export async function seedGraph(
  page: Page,
  example: Example,
  { name, within = 10 * 60_000, reuse = false }: { name: string; within?: number; reuse?: boolean },
): Promise<string> {
  const script = mapping(example);
  if (reuse) {
    const listed = await api(page, "GET", "/v1/graphs");
    const graphs = listed.body as { id: string; name: string | null; status: string }[];
    const done = graphs.find((g) => g.name === name && g.status === "completed");
    if (done) return done.id;
  }
  return runToCompletion(page, { name, script, within });
}
