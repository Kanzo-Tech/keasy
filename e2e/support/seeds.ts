import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

import { runToCompletion } from "./fixtures";

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

/**
 * A graph of the dev example `example`, named `name`, run to completion by the browser on `page`
 * (which must be signed in), within `within` ms. A built graph is written once, so each call builds
 * its own: one found by name could be a graph an older writer built.
 */
export async function seedGraph(
  page: Page,
  example: Example,
  { name, within = 10 * 60_000 }: { name: string; within?: number },
): Promise<string> {
  return runToCompletion(page, { name, script: mapping(example), within });
}
