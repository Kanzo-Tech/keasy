/**
 * The failure guards (fossil docs/design/failure, "The guards"), as tests over the web's own source
 * and `@keasy/api`'s. Each holds a rule nobody should have to remember, says why, and says what it
 * cannot prove.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const ROOTS = [join(WEB, "src"), join(WEB, "..", "api", "src")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const FILES = ROOTS.flatMap(walk).map((path) => ({
  path: relative(join(WEB, ".."), path),
  lines: readFileSync(path, "utf8").split("\n"),
}));

/** Every line matching `pattern`, as `file:line`, unless `allowed` says the line or its context earns it. */
function offenders(pattern: RegExp, allowed: (lines: string[], i: number, path: string) => boolean = () => false) {
  return FILES.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) => (pattern.test(line) && !allowed(lines, i, path) ? [`${path}:${i + 1}`] : [])),
  );
}

const commented = (lines: string[], i: number) => lines[i].includes("//");

describe("the failure guards", () => {
  /**
   * A failure swallowed is a failure nobody sees. An empty `catch`, or a `.catch` that throws the
   * failure away, needs a comment on the line saying why losing it is correct — a cancellation, a
   * cleanup whose failure is not the one being reported. A `catch` whose body is only a comment is
   * that comment.
   *
   * Cannot prove: that the reason is true; a failure swallowed another way (`try` with a `finally`
   * that returns).
   */
  it("swallows no failure without a reason on the line", () => {
    expect(offenders(/catch\s*(\([^)]*\))?\s*\{\s*\}/, commented)).toEqual([]);
    expect(offenders(/\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\)/, commented)).toEqual([]);
  });

  /**
   * `x ??= start()` caches whatever `start()` returned for the life of the page — a rejected promise
   * included, so one transient failure poisons the tab until it is reloaded. A cached promise is
   * cleared when it rejects instead (`lib/fossil/checker.ts`).
   *
   * Cannot prove: that the call returns a promise; a memoization spelled another way.
   */
  it("memoizes no call's result with ??=", () => {
    expect(offenders(/\?\?=\s*[\w.$]+\s*\(/, commented)).toEqual([]);
  });

  /**
   * Every wait on the network has a deadline, set in one place: `lib/deadline.ts`, whose
   * `deadlineFetch` is the BFF auth client's fetch and so every API call's — a model call's
   * included, which it hands whole to the gateway's own bound.
   *
   * Cannot prove: that the figure is right; a request made by a library keasy calls.
   */
  it("fetches only through the deadline helper", () => {
    expect(
      offenders(/(^|[^\w.])fetch\(|(globalThis|window)\.fetch\(/, (_, __, path) => path === "web/src/lib/deadline.ts"),
    ).toEqual([]);
  });

  /**
   * A query that fails throws to the nearest `Boundary`, which shows it by `ProblemView` — so no
   * screen can forget to read `error` and draw an empty list instead. `useQuery` and `useQueries`
   * are the named exceptions, each with its reason beside the call: partial data worth showing next
   * to the failure.
   *
   * Cannot prove: that a boundary renders `ProblemView` rather than something else.
   */
  it("reads data with useSuspenseQuery, but for the named exceptions", () => {
    const EXCEPTIONS = new Set([
      // One listing per selected connection; the loaded ones are shown beside the one that failed.
      "web/src/app/(main)/(chrome)/(member)/jobs/new/_parts/assistant-wizard.tsx",
      // Follows every pause in typing; the editor shows the failure beside the program.
      "web/src/app/(main)/(chrome)/(member)/jobs/new/_parts/use-source-descriptors.ts",
      // Follows every pause in typing; a failed question leaves the folder to Create's own answer.
      "web/src/app/(main)/(chrome)/(member)/jobs/new/_parts/use-folder-availability.ts",
      // A crumb's label: the route's own name stands until the job's arrives, and the job's page shows its failure.
      "web/src/app/(main)/_parts/trail.tsx",
    ]);
    expect(offenders(/\b(useQuery|useQueries)\(/, (_, __, path) => EXCEPTIONS.has(path))).toEqual([]);
  });

  /**
   * Every route group under `(main)` draws its shell, so each has an `error.tsx` that renders the
   * failure inside it; the root layout's own failures land on `global-error.tsx`.
   *
   * Cannot prove: that the boundary renders `ProblemView`.
   */
  it("gives every route group an error boundary", () => {
    const main = join(WEB, "src", "app", "(main)");
    const groups = readdirSync(main).filter((name) => /^\(.+\)$/.test(name));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((group) => !existsSync(join(main, group, "error.tsx")))).toEqual([]);
    expect(existsSync(join(WEB, "src", "app", "global-error.tsx"))).toBe(true);
  });

  /**
   * `notFound()` draws Next's page, which cannot say what is missing or why; a 403 or a 500 drawn as
   * "not found" is a failure disguised. So it is called only in a branch that tested a not-found
   * code, on its line or the two above.
   */
  it("calls notFound() only inside a not-found branch", () => {
    expect(
      offenders(/\bnotFound\(\)/, (lines, i) => lines.slice(Math.max(0, i - 2), i + 1).some((l) => l.includes("not-found"))),
    ).toEqual([]);
  });
});
