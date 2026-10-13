/**
 * The one failure guard no linter states, because it reads the file tree rather than a file: the
 * rest are rules in `eslint.config.mjs`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const APP = join(__dirname, "app");

/**
 * Every route group under `(main)` draws its shell, so each has an `error.tsx` that renders the
 * failure inside it; the root layout's own failures land on `global-error.tsx`.
 *
 * Cannot prove: that the boundary renders `ProblemView`.
 */
it("gives every route group an error boundary", () => {
  const main = join(APP, "(main)");
  const groups = readdirSync(main).filter((name) => /^\(.+\)$/.test(name));
  expect(groups.length).toBeGreaterThan(0);
  expect(groups.filter((group) => !existsSync(join(main, group, "error.tsx")))).toEqual([]);
  expect(existsSync(join(APP, "global-error.tsx"))).toBe(true);
});
