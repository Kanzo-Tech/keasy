import { Query, asc, count, sql } from "@kanzo-tech/ui/analytics";
import {
  and,
  column,
  eq,
  gt,
  isIn,
  isNotNull,
  isNull,
  length,
  literal,
  lt,
  neq,
  not,
  regexp_matches,
  verbatim,
  type ExprNode,
} from "@uwdata/mosaic-sql";
import { type Shown, toProblem } from "@/lib/errors";

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
  /** Vertices that break the rule; `-1` when the rule is incomplete or its query failed. */
  violationCount: number;
  /** Why its query failed, when it did. */
  problem?: Shown;
}

// ── Operator metadata ────────────────────────────────────────────────────

interface OperatorMeta {
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

/**
 * The builders read FROM a relation as the corpus names it — `"jobs/7"."Person"`, catalog and all —
 * which mosaic-sql would quote again as one identifier, so it rides `verbatim`.
 */
const from = (relation: string) => Query.from(verbatim(relation));

/** Build a mosaic-sql expression that matches VIOLATING rows for a rule. */
function violationExpr(rule: Rule, relation: string): ExprNode | null {
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
    case "unique": {
      // A row breaks uniqueness when its value is one another row also holds.
      const repeated = from(relation).select({ v: col }).groupby(col).having(gt(count(), literal(1)));
      return sql`${col} IN (${repeated})`;
    }
  }
}

// ── Query builders (return mosaic-sql Query objects) ─────────────────────

/** Query that returns the key of every vertex that breaks the rule — what the canvas selects. */
export function ruleIdsQuery(rule: Rule, relation: string, key: string): Query | null {
  const expr = violationExpr(rule, relation);
  if (!expr) return null;
  return from(relation).select({ id: column(key) }).where(expr);
}

/** Query that returns the count of vertices that break the rule. */
export function ruleCountQuery(rule: Rule, relation: string): Query | null {
  const expr = violationExpr(rule, relation);
  if (!expr) return null;
  return from(relation).select({ cnt: count() }).where(expr);
}

/** Query for distinct values of a field (autocomplete). */
export function distinctValuesQuery(field: string, relation: string, limit = 50): Query {
  return from(relation)
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

export async function runRules(
  rules: Rule[],
  execQuery: QueryFn,
  relation: (typeName: string) => string,
): Promise<RuleResult[]> {
  return Promise.all(
    rules.map(async (rule): Promise<RuleResult> => {
      const query = isRuleComplete(rule) ? ruleCountQuery(rule, relation(rule.typeName ?? "")) : null;
      if (!query) return { rule, passed: false, violationCount: -1 };
      try {
        const [row] = await execQuery(query);
        const violationCount = Number(row.cnt);
        return { rule, passed: violationCount === 0, violationCount };
      } catch (err) {
        return { rule, passed: false, violationCount: -1, problem: toProblem(err, "query/failed") };
      }
    }),
  );
}
