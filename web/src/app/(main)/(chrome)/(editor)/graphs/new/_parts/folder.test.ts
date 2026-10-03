import { describe, expect, it } from "vitest";
import { schemaOf } from "@/lib/api/spec";
import { FOLDER_MAX, folderProblem, folderSlug } from "./folder";

describe("folderSlug", () => {
  it("turns a name into a folder the server accepts", () => {
    expect(folderSlug("People & Orders 2026")).toBe("people-orders-2026");
    expect(folderSlug("  Año Nuevo  ")).toBe("ano-nuevo");
    expect(folderSlug("--x--")).toBe("x");
    expect(folderSlug("")).toBe("graph");
    expect(folderSlug("ñ!")).toBe("n");
    expect(folderSlug("!!!")).toBe("graph");
    const long = folderSlug(`${"a".repeat(FOLDER_MAX - 1)} b`);
    expect(long.length).toBeLessThanOrEqual(FOLDER_MAX);
    expect(long.endsWith("-")).toBe(false);
  });

  it("always yields a folder folderProblem accepts", () => {
    for (const name of ["", "Ünïcödé", "a/b/c", "UPPER case", "x".repeat(200)]) {
      expect(folderProblem(folderSlug(name))).toBeNull();
    }
  });
});

describe("folderProblem", () => {
  it("is the contract's GraphFolder rule", () => {
    expect(FOLDER_MAX).toBe(schemaOf("GraphFolder").maxLength);
  });

  it("refuses what the server refuses", () => {
    for (const bad of ["", "-lead", "Upper", "a b", "a/b", "a_b", "x".repeat(FOLDER_MAX + 1)]) {
      expect(folderProblem(bad)).not.toBeNull();
    }
    for (const ok of ["people", "hr-2026", "0", "a-", "x".repeat(FOLDER_MAX)]) {
      expect(folderProblem(ok)).toBeNull();
    }
  });
});
