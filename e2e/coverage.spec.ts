import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { ELSEWHERE, SCENARIOS } from "./support/stack/scenarios";

const TESTS = join(dirname(fileURLToPath(import.meta.url)), "tests");

/**
 * Every scenario of the failure audit has a test named `NN …`, or says which other suite forces it.
 *
 * Cannot prove: that a test forces the failure its name says.
 */
test("every audit scenario has a test by name", () => {
  const source = readdirSync(TESTS)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => readFileSync(join(TESTS, name), "utf8"))
    .join("\n");

  const named = new Set([...source.matchAll(/test\(\s*["'`](\d{2}) /g)].map((m) => Number(m[1])));
  const missing = Object.keys(SCENARIOS)
    .map(Number)
    .filter((n) => !named.has(n) && !(n in ELSEWHERE));
  expect(missing, "scenarios with no test").toEqual([]);
});
