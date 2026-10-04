"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { column, literal, Query, sql, verbatim, type FilterExpr } from "@uwdata/mosaic-sql";
import { useChartQuery } from "@kanzo-tech/ui/analytics";
import type { LangString, NodeShapeIR, ShapeModelJson, TermValue } from "@kanzo-tech/metadata-form/rudof";
import type { Session } from "@kanzo-tech/rudof-wasm";
import { corpusKey, useCorpus, useCorpusMapping, useVertices } from "@/lib/fossil/corpus";

/**
 * A graph's rules, validated by rudof's SQL engine on the page's own DuckDB: the shapes are compiled
 * against the corpus's RML mapping into one `SELECT` per shape and constraint component, every check
 * runs as one client of the page's crossfilter, and rudof reads the rows back as the SHACL
 * validation report the native engine would have written.
 */

/** rudof's SHACL stack, instantiated once and only when the rules are read: the graph never loads it. */
let rudofOnce: Promise<typeof import("@kanzo-tech/rudof-wasm")> | undefined;
function rudof() {
  if (!rudofOnce) {
    const loading = import("@kanzo-tech/rudof-wasm").then(async (module) => {
      await module.default();
      return module;
    });
    rudofOnce = loading;
    // A failed instantiation is not kept: the next read tries again.
    loading.catch(() => rudofOnce === loading && (rudofOnce = undefined));
  }
  return rudofOnce;
}

/** `Session.compileSql`'s plan: the columns every check answers, and the checks in report order. */
interface SqlPlan {
  columns: string[];
  checks: { sql: string }[];
}

/** One `sh:ValidationResult`, as `Session.reportFromRows` words it. */
export interface ValidationResult {
  focusNode: TermValue;
  pathKey?: string;
  value?: TermValue;
  message: LangString[];
  severity?: string;
  sourceConstraintComponent?: string;
  sourceShape?: TermValue;
}

export interface ValidationReport {
  conforms: boolean;
  results: ValidationResult[];
}

/** The rules as rudof read them: their node shapes, and the session that holds their plan. */
export interface CompiledRules {
  session: Session;
  shapes: NodeShapeIR[];
  plan: SqlPlan;
}

/**
 * The rules document compiled for the corpus, under the catalog it is attached as. A shape the
 * engine refuses — a recursive one, a component it does not compile — is the failure, never skipped.
 * The last plan stays while the next compiles, so an edit does not empty the panel.
 */
export function useCompiledRules(shapes: string) {
  const { graphId } = useCorpus();
  const mapping = useCorpusMapping();
  const compiled = useQuery({
    queryKey: [...corpusKey(graphId), "rules", shapes],
    queryFn: async (): Promise<CompiledRules> => {
      const { Session } = await rudof();
      const session = new Session();
      const model = session.loadShapes(shapes, "text/turtle") as ShapeModelJson;
      const plan = session.compileSql(mapping, graphId, "duckdb") as SqlPlan;
      return { session, shapes: model.nodeShapes, plan };
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  return { compiled: compiled.data, failure: compiled.error ?? undefined };
}

/** Which check a row answers, beside the plan's own columns. */
const CHECK = "check";

/** Whether the page's selection holds anything for this client. */
const filtering = (filter: FilterExpr) => [filter].flat().some(Boolean);

/**
 * The validation report of `compiled`, scoped by the page's selection: every check is one subquery of
 * one statement, a client of the crossfilter, so a lasso, a brush or an answer narrows the findings to
 * the vertices it keeps. A check's focus nodes are the corpus's subjects; the selection names vertices,
 * so the scope is the subjects of the vertices it keeps.
 */
export function useValidationReport(compiled: CompiledRules | undefined) {
  const vertices = useVertices();
  const checks = compiled?.plan.checks.length ?? 0;
  const answer = useChartQuery({
    deps: [compiled, vertices],
    query: (filter) => {
      if (!compiled || checks === 0) return null;
      const scope = Query.from(vertices).select("subject").where(filter);
      return Query.unionAll(
        ...compiled.plan.checks.map((check, at) => {
          const rows = Query.from({ rows: verbatim(`(${check.sql})`) }).select({ [CHECK]: literal(at) }, ...compiled.plan.columns);
          return filtering(filter) ? rows.where(sql`${column("focus_value")} IN (${scope})`) : rows;
        }),
      );
    },
  });
  const report = useMemo((): ValidationReport | undefined => {
    if (!compiled) return undefined;
    if (checks === 0) return { conforms: true, results: [] };
    if (!answer.rows) return undefined;
    // One array of rows per check, in plan order, each row the plan's columns as text.
    const perCheck: (string | null)[][][] = compiled.plan.checks.map(() => []);
    for (const row of answer.rows) {
      perCheck[Number(row[CHECK])].push(compiled.plan.columns.map((c) => (row[c] == null ? null : String(row[c]))));
    }
    return compiled.session.reportFromRows(perCheck) as ValidationReport;
  }, [compiled, checks, answer.rows]);
  return { report, failure: answer.error };
}
