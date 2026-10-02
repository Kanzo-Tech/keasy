import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { SCENARIOS } from "./support/scenarios";

const TESTS = join(dirname(fileURLToPath(import.meta.url)), "tests");

/**
 * Every scenario of the failure audit has a test named `NN …` — a real one, or a `test.fixme` whose
 * reason (its second argument's first statement, a string) says what it waits for.
 *
 * Cannot prove: that a test forces the failure its name says.
 */
test("every audit scenario has a test by name, and every fixme a reason", () => {
  const source = readdirSync(TESTS)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => readFileSync(join(TESTS, name), "utf8"))
    .join("\n");

  const named = new Map<number, "real" | "fixme">();
  for (const m of source.matchAll(/test(\.fixme)?\(\s*["'`](\d{2}) /g)) {
    named.set(Number(m[2]), m[1] ? "fixme" : "real");
  }
  const missing = Object.keys(SCENARIOS).map(Number).filter((n) => !named.has(n));
  expect(missing, "scenarios with no test").toEqual([]);

  const unexplained = [...source.matchAll(/test\.fixme\(\s*["'`](\d{2}) [^"'`]*["'`],\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{\s*([^\n]*)/g)]
    .filter((m) => !/^\/\/ waits on /.test(m[2].trim()))
    .map((m) => m[1]);
  expect(unexplained, "fixme tests without a `// waits on …` reason").toEqual([]);
});
