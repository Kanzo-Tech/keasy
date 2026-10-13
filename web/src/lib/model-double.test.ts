import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");
const NAME = "__keasyModelDouble";

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(name) ? [path] : [];
  });
}

/** A production build in this tree: `next build` writes `BUILD_ID`, which `next dev` does not. */
const BUILT = existsSync(join(WEB, ".next", "BUILD_ID"));
/** Set by CI after `next build`, so a missing bundle fails the check instead of skipping it. */
const REQUIRED = process.env.KEASY_BUNDLE_CHECK === "1";

/**
 * The e2e suite's model double (`lib/ai.ts`, `e2e/support/model.ts`) is a seam into what the page asks
 * the model, and a production page must have none: whatever a script put on `window` would answer for
 * the model. It is read in one place, behind `process.env.NODE_ENV === "production"`, which the build
 * inlines, so the branch and the name go with it.
 *
 * Cannot prove: that a development server is never exposed — it is the e2e suite's, and the image
 * keasy ships runs `next build`'s output.
 */
describe("the model double", () => {
  it("is read in one place, behind the production check", () => {
    const readers = walk(join(WEB, "src"), (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)).filter((path) =>
      readFileSync(path, "utf8").includes(NAME),
    );
    expect(readers.map((path) => relative(WEB, path))).toEqual(["src/lib/ai.ts"]);
    const source = readFileSync(join(WEB, "src", "lib", "ai.ts"), "utf8");
    const reader = source.slice(source.indexOf("function modelDouble()"));
    expect(reader.indexOf('if (process.env.NODE_ENV === "production") return undefined;')).toBeGreaterThan(0);
    expect(reader.indexOf('if (process.env.NODE_ENV === "production") return undefined;')).toBeLessThan(reader.indexOf(NAME));
  });

  it.skipIf(!BUILT && !REQUIRED)("is not in the production bundle", () => {
    expect(BUILT, "no production build in web/.next: run `next build` first").toBe(true);
    // What the build emitted, for the browser and the server alike; not `next dev`'s output or caches.
    const chunks = ["static", "server", "standalone"]
      .map((dir) => join(WEB, ".next", dir))
      .filter(existsSync)
      .flatMap((dir) => walk(dir, (name) => name.endsWith(".js")))
      .filter((path) => !path.includes("node_modules"));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.filter((path) => readFileSync(path, "utf8").includes(NAME)).map((path) => relative(WEB, path))).toEqual([]);
  });
});
