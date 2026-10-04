import { describe, expect, it } from "vitest";
import { schemaOf } from "@/lib/api/spec";
import { NAME_MAX, nameProblem } from "./graph-name";

describe("nameProblem", () => {
  it("is the contract's ResourceName rule", () => {
    expect(NAME_MAX).toBe(schemaOf("ResourceName").maxLength);
  });

  it("refuses what the server refuses", () => {
    for (const bad of ["a/b", "a@b", "a\\b", "a\u0007b", "x".repeat(NAME_MAX + 1)]) {
      expect(nameProblem(bad)).not.toBeNull();
    }
  });

  it("accepts names in any script, counted in code points", () => {
    for (const ok of ["People & Orders", "Año nuevo", "人事 2026", "x", "😀".repeat(NAME_MAX)]) {
      expect(nameProblem(ok)).toBeNull();
    }
  });

  it("judges the name as sent: trimmed, and none at all when empty", () => {
    expect(nameProblem("")).toBeNull();
    expect(nameProblem("   ")).toBeNull();
    expect(nameProblem("  padded  ")).toBeNull();
  });
});
