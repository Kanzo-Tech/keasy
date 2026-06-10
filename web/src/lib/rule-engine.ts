import {
  Query,
  column,
  count,
  literal,
  sql,
  isNull,
  isNotNull,
  not,
  lt,
  gt,
  eq,
  neq,
  isIn,
  regexp_matches,
  length,
  and,
  asc,
  desc,
} from "@uwdata/mosaic-sql";
import type { ExprNode } from "@uwdata/mosaic-sql";

// ── Types ────────────────────────────────────────────────────────────────

export type RuleOperator =
  | "not_null"
  | "unique"
  | "min"
  | "max"
  | "equals"
  | "not_equals"
  | "in_set"
  | "pattern"
  | "min_length"
  | "max_length"
  | "datatype";

export interface Rule {
  id: string;
  fieldKey: string;
  operator: RuleOperator;
  value?: string | number;
  values?: string[];
  /** Entity type this rule belongs to (from manifest) */
  typeName?: string;
}

export interface RuleResult {
  rule: Rule;
  passed: boolean;
  violationCount: number;
  violations: Record<string, unknown>[];
  totalRows: number;
}

// ── Operator metadata ────────────────────────────────────────────────────

export interface OperatorMeta {
  label: string;
  needsValue: boolean;
  needsValues: boolean;
  placeholder?: string;
}

export const OPERATOR_META: Record<RuleOperator, OperatorMeta> = {
  not_null: { label: "Must have value", needsValue: false, needsValues: false },
  unique: { label: "Must be unique", needsValue: false, needsValues: false },
  min: { label: "Minimum", needsValue: true, needsValues: false },
  max: { label: "Maximum", needsValue: true, needsValues: false },
  equals: { label: "Equals", needsValue: true, needsValues: false },
  not_equals: { label: "Not equals", needsValue: true, needsValues: false },
  in_set: { label: "One of", needsValue: false, needsValues: true },
  pattern: { label: "Pattern", needsValue: true, needsValues: false, placeholder: "^.+@.+$" },
  min_length: { label: "Min length", needsValue: true, needsValues: false },
  max_length: { label: "Max length", needsValue: true, needsValues: false },
  datatype: { label: "Datatype", needsValue: true, needsValues: false, placeholder: "INTEGER" },
};

// ── Violation expression builder ─────────────────────────────────────────

/** Build a mosaic-sql expression that matches VIOLATING rows for a rule. */
function violationExpr(rule: Rule): ExprNode | null {
  const col = column(rule.fieldKey);
  const meta = OPERATOR_META[rule.operator];

  if (meta.needsValue && (rule.value == null || rule.value === "")) return null;
  if (meta.needsValues && (!rule.values || rule.values.length === 0)) return null;

  switch (rule.operator) {
    case "not_null":
      return isNull(col);
    case "min":
      return lt(col, literal(Number(rule.value)));
    case "max":
      return gt(col, literal(Number(rule.value)));
    case "equals":
      return neq(col, literal(rule.value!));
    case "not_equals":
      return eq(col, literal(rule.value!));
    case "in_set": {
      const vals = (rule.values ?? []).map((v) => literal(v));
      return not(isIn(col, vals));
    }
    case "pattern":
      return not(regexp_matches(col, literal(String(rule.value))));
    case "min_length":
      return lt(length(col), literal(Number(rule.value)));
    case "max_length":
      return gt(length(col), literal(Number(rule.value)));
    case "datatype":
      return and(
        isNotNull(col),
        isNull(sql`TRY_CAST(${col} AS ${String(rule.value).toUpperCase()})`),
      );
    case "unique":
      return null; // unique uses a different query shape
  }
}

// ── Query builders (return mosaic-sql Query objects) ─────────────────────

/** Query that returns sample violation rows (up to limit). */
export function ruleViolationQuery(rule: Rule, limit = 100): Query | null {
  const table = rule.typeName ?? "data";
  if (rule.operator === "unique") {
    return Query.from(table)
      .select({ [rule.fieldKey]: column(rule.fieldKey), duplicate_count: count() })
      .groupby(column(rule.fieldKey))
      .having(gt(count(), literal(1)))
      .orderby(desc("duplicate_count"))
      .limit(limit);
  }
  const expr = violationExpr(rule);
  if (!expr) return null;
  return Query.from(table).select("*").where(expr).limit(limit);
}

/** Query that returns the count of violations. */
export function ruleCountQuery(rule: Rule): Query | null {
  const table = rule.typeName ?? "data";
  if (rule.operator === "unique") {
    const sub = Query.from(table)
      .select({ one: literal(1) })
      .groupby(column(rule.fieldKey))
      .having(gt(count(), literal(1)));
    return Query.select({ cnt: count() }).from(sub);
  }
  const expr = violationExpr(rule);
  if (!expr) return null;
  return Query.from(table).select({ cnt: count() }).where(expr);
}

/** Query that returns total row count for a given type. */
export function totalRowCountQuery(typeName: string): Query {
  return Query.from(typeName).select({ cnt: count() });
}

/** Query for distinct values of a field (autocomplete). */
export function distinctValuesQuery(field: string, typeName: string, limit = 50): Query {
  return Query.from(typeName)
    .select({ value: column(field) })
    .distinct()
    .orderby(asc("value"))
    .limit(limit);
}

/** Check if a rule has all required values filled in. */
export function isRuleComplete(rule: Rule): boolean {
  const meta = OPERATOR_META[rule.operator];
  if (meta.needsValue && (rule.value == null || rule.value === "")) return false;
  if (meta.needsValues && (!rule.values || rule.values.length === 0)) return false;
  return true;
}

// ── Run all rules via Mosaic coordinator ─────────────────────────────────

type QueryFn = (query: Query) => Promise<Record<string, unknown>[]>;

export async function runRules(rules: Rule[], execQuery: QueryFn): Promise<RuleResult[]> {
  // Fetch total row counts per unique type in parallel
  const uniqueTypes = [...new Set(rules.map((r) => r.typeName ?? "data"))];
  const typeCounts = new Map<string, number>();
  await Promise.all(
    uniqueTypes.map(async (t) => {
      const [row] = await execQuery(totalRowCountQuery(t));
      typeCounts.set(t, Number(row.cnt));
    }),
  );

  // Execute all rules in parallel
  const results = await Promise.all(
    rules.map(async (rule): Promise<RuleResult> => {
      const totalRows = typeCounts.get(rule.typeName ?? "data") ?? 0;
      if (!isRuleComplete(rule)) {
        return { rule, passed: false, violationCount: -1, violations: [], totalRows };
      }
      try {
        const countQ = ruleCountQuery(rule);
        if (!countQ) {
          return { rule, passed: false, violationCount: -1, violations: [], totalRows };
        }
        const [countRow] = await execQuery(countQ);
        const violationCount = Number(countRow.cnt);

        const violationQ = ruleViolationQuery(rule);
        const violations = violationCount > 0 && violationQ
          ? await execQuery(violationQ)
          : [];

        return { rule, passed: violationCount === 0, violationCount, violations, totalRows };
      } catch {
        return { rule, passed: false, violationCount: -1, violations: [], totalRows };
      }
    }),
  );

  return results;
}
