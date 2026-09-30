import { describe, it, expect } from "vitest";
import {
  ruleIdsQuery,
  ruleCountQuery,
  distinctValuesQuery,
  isRuleComplete,
  type Rule,
} from "./rule-engine";

/** A relation as the corpus names it: catalog and all, quoted already. */
const REL = '"jobs/7"."Person"';

describe("rule-engine", () => {
  describe("isRuleComplete", () => {
    it("returns true for not_null (no value needed)", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      expect(isRuleComplete(rule)).toBe(true);
    });

    it("returns true for unique (no value needed)", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "unique" };
      expect(isRuleComplete(rule)).toBe(true);
    });

    it("returns false for min without value", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min" };
      expect(isRuleComplete(rule)).toBe(false);
    });

    it("returns true for min with value", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min", value: "5" };
      expect(isRuleComplete(rule)).toBe(true);
    });

    it("returns false for in_set without values", () => {
      const rule: Rule = { id: "1", fieldKey: "status", operator: "in_set" };
      expect(isRuleComplete(rule)).toBe(false);
    });

    it("returns true for in_set with values", () => {
      const rule: Rule = { id: "1", fieldKey: "status", operator: "in_set", values: ["a", "b"] };
      expect(isRuleComplete(rule)).toBe(true);
    });
  });

  describe("query builders produce valid SQL", () => {
    it("ruleCountQuery reads the relation as the corpus names it, unquoted again", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      expect(ruleCountQuery(rule, REL)!.toString()).toContain(`FROM ${REL}`);
    });

    it("distinctValuesQuery generates DISTINCT + ORDER BY + LIMIT", () => {
      const q = distinctValuesQuery("category", REL, 10);
      const sql = q.toString();
      expect(sql).toMatch(/DISTINCT/i);
      expect(sql).toMatch(/"category"/);
      expect(sql).toMatch(/LIMIT\s+10/i);
      expect(sql).toContain(`FROM ${REL}`);
    });

    it("ruleIdsQuery for not_null selects the key of every IS NULL row", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      const q = ruleIdsQuery(rule, REL, "dense_id");
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/"dense_id"/);
      expect(sql).toMatch(/IS NULL/i);
      expect(sql).toMatch(/"name"/);
    });

    it("ruleIdsQuery for unique selects the rows whose value repeats", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "unique" };
      const q = ruleIdsQuery(rule, REL, "dense_id");
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/GROUP BY/i);
      expect(sql).toMatch(/HAVING/i);
      expect(sql).toMatch(/COUNT\(\*\)\s*>\s*1/i);
    });

    it("ruleIdsQuery for min finds values below threshold", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min", value: "5" };
      const q = ruleIdsQuery(rule, REL, "dense_id");
      const sql = q!.toString();
      expect(sql).toMatch(/"price"\s*<\s*5/);
    });

    it("ruleIdsQuery for in_set finds values NOT IN set", () => {
      const rule: Rule = { id: "1", fieldKey: "status", operator: "in_set", values: ["active", "pending"] };
      const q = ruleIdsQuery(rule, REL, "dense_id");
      const sql = q!.toString();
      expect(sql).toMatch(/NOT/i);
      expect(sql).toMatch(/IN/i);
      expect(sql).toMatch(/'active'/);
      expect(sql).toMatch(/'pending'/);
    });

    it("ruleIdsQuery for pattern finds non-matching rows", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "pattern", value: "^.+@.+$" };
      const q = ruleIdsQuery(rule, REL, "dense_id");
      const sql = q!.toString();
      expect(sql).toMatch(/REGEXP_MATCHES/i);
      expect(sql).toMatch(/NOT/i);
    });

    it("ruleCountQuery for not_null returns count of NULLs", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      const q = ruleCountQuery(rule, REL);
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/COUNT\(\*\)/i);
      expect(sql).toMatch(/IS NULL/i);
    });

    it("ruleCountQuery for unique wraps in subquery", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "unique" };
      const q = ruleCountQuery(rule, REL);
      const sql = q!.toString();
      expect(sql).toMatch(/COUNT\(\*\)/i);
      expect(sql).toMatch(/GROUP BY/i);
      expect(sql).toMatch(/HAVING/i);
    });

    it("returns null for incomplete rules", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min" };
      expect(ruleIdsQuery(rule, REL, "dense_id")).toBeNull();
      expect(ruleCountQuery(rule, REL)).toBeNull();
    });
  });
});
