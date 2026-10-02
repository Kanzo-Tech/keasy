import { describe, expect, it } from "vitest";
import { folderProblem, folderSlug } from "./folder";

describe("folderSlug", () => {
  it("turns a name into a folder the server accepts", () => {
    expect(folderSlug("People & Orders 2026")).toBe("people-orders-2026");
    expect(folderSlug("  Año Nuevo  ")).toBe("ano-nuevo");
    expect(folderSlug("--x--")).toBe("x");
    expect(folderSlug("")).toBe("job");
    expect(folderSlug("ñ!")).toBe("n");
    expect(folderSlug("!!!")).toBe("job");
    const long = folderSlug(`${"a".repeat(62)} b`);
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-")).toBe(false);
  });

  it("always yields a folder folderProblem accepts", () => {
    for (const name of ["", "Ünïcödé", "a/b/c", "UPPER case", "x".repeat(200)]) {
      expect(folderProblem(folderSlug(name))).toBeNull();
    }
  });
});

describe("folderProblem", () => {
  it("refuses what the server refuses", () => {
    for (const bad of ["", "-lead", "Upper", "a b", "a/b", "a_b", "x".repeat(64)]) {
      expect(folderProblem(bad)).not.toBeNull();
    }
    for (const ok of ["people", "hr-2026", "0", "a-"]) {
      expect(folderProblem(ok)).toBeNull();
    }
  });
});
