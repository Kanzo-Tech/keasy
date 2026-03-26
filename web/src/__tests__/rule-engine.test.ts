import { describe, it, expect } from "vitest";
import {
  ruleViolationQuery,
  ruleCountQuery,
  totalRowCountQuery,
  distinctValuesQuery,
  isRuleComplete,
  type Rule,
} from "@/lib/rule-engine";

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
    it("totalRowCountQuery generates COUNT(*) from given type", () => {
      const q = totalRowCountQuery("orders");
      const sql = q.toString();
      expect(sql).toMatch(/COUNT\(\*\)/i);
      expect(sql).toMatch(/FROM\s+"orders"/i);
    });

    it("distinctValuesQuery generates DISTINCT + ORDER BY + LIMIT", () => {
      const q = distinctValuesQuery("category", "products", 10);
      const sql = q.toString();
      expect(sql).toMatch(/DISTINCT/i);
      expect(sql).toMatch(/"category"/);
      expect(sql).toMatch(/LIMIT\s+10/i);
      expect(sql).toMatch(/FROM\s+"products"/i);
    });

    it("ruleViolationQuery for not_null finds IS NULL rows", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      const q = ruleViolationQuery(rule);
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/IS NULL/i);
      expect(sql).toMatch(/"name"/);
      expect(sql).toMatch(/LIMIT\s+100/i);
    });

    it("ruleViolationQuery for unique uses GROUP BY + HAVING", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "unique" };
      const q = ruleViolationQuery(rule);
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/GROUP BY/i);
      expect(sql).toMatch(/HAVING/i);
      expect(sql).toMatch(/COUNT\(\*\)\s*>\s*1/i);
    });

    it("ruleViolationQuery for min finds values below threshold", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min", value: "5" };
      const q = ruleViolationQuery(rule);
      const sql = q!.toString();
      expect(sql).toMatch(/"price"\s*<\s*5/);
    });

    it("ruleViolationQuery for in_set finds values NOT IN set", () => {
      const rule: Rule = { id: "1", fieldKey: "status", operator: "in_set", values: ["active", "pending"] };
      const q = ruleViolationQuery(rule);
      const sql = q!.toString();
      expect(sql).toMatch(/NOT/i);
      expect(sql).toMatch(/IN/i);
      expect(sql).toMatch(/'active'/);
      expect(sql).toMatch(/'pending'/);
    });

    it("ruleViolationQuery for pattern finds non-matching rows", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "pattern", value: "^.+@.+$" };
      const q = ruleViolationQuery(rule);
      const sql = q!.toString();
      expect(sql).toMatch(/REGEXP_MATCHES/i);
      expect(sql).toMatch(/NOT/i);
    });

    it("ruleCountQuery for not_null returns count of NULLs", () => {
      const rule: Rule = { id: "1", fieldKey: "name", operator: "not_null" };
      const q = ruleCountQuery(rule);
      expect(q).not.toBeNull();
      const sql = q!.toString();
      expect(sql).toMatch(/COUNT\(\*\)/i);
      expect(sql).toMatch(/IS NULL/i);
    });

    it("ruleCountQuery for unique wraps in subquery", () => {
      const rule: Rule = { id: "1", fieldKey: "email", operator: "unique" };
      const q = ruleCountQuery(rule);
      const sql = q!.toString();
      expect(sql).toMatch(/COUNT\(\*\)/i);
      expect(sql).toMatch(/GROUP BY/i);
      expect(sql).toMatch(/HAVING/i);
    });

    it("returns null for incomplete rules", () => {
      const rule: Rule = { id: "1", fieldKey: "price", operator: "min" };
      expect(ruleViolationQuery(rule)).toBeNull();
      expect(ruleCountQuery(rule)).toBeNull();
    });
  });
});
