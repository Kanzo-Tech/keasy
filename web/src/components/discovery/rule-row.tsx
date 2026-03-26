"use client";

import { useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type Rule,
  type RuleOperator,
  type RuleResult,
  OPERATOR_META,
} from "@/lib/rule-engine";
import { type GraphSchema } from "@/lib/graph-schema";
import { useCoordinatorQuery } from "./use-discovery-store";
import { Query, column, asc } from "@uwdata/mosaic-sql";

// ── Shared helpers ───────────────────────────────────────────────────────

interface RuleCellProps {
  rule: Rule;
  schema: GraphSchema;
  onChange: (updated: Rule) => void;
}

/* parseValue removed — Mosaic search handles type coercion */

// ── Cell renderers ───────────────────────────────────────────────────────

export function EntitySelect({ rule, schema, onChange }: RuleCellProps) {
  function handleTypeChange(typeName: string) {
    const fields = schema.fieldsOf(typeName);
    const firstCol = fields[0]?.name ?? rule.fieldKey;
    onChange({ ...rule, typeName, fieldKey: firstCol, value: undefined, values: undefined });
  }

  return (
    <Select value={rule.typeName ?? schema.types[0]?.name ?? ""} onValueChange={handleTypeChange}>
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue placeholder="Entity" />
      </SelectTrigger>
      <SelectContent>
        {schema.types.map((t) => (
          <SelectItem key={t.name} value={t.name}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FieldSelect({ rule, schema, onChange }: RuleCellProps) {
  const typeFields = schema.fieldsOf(rule.typeName ?? "");

  function handleFieldChange(fieldKey: string) {
    const ops = Object.keys(OPERATOR_META) as RuleOperator[];
    const operator = ops.includes(rule.operator) ? rule.operator : ops[0];
    onChange({ ...rule, fieldKey, operator, value: undefined, values: undefined });
  }

  return (
    <Select value={rule.fieldKey} onValueChange={handleFieldChange}>
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue placeholder="Select field" />
      </SelectTrigger>
      <SelectContent>
        {typeFields.map((f) => (
          <SelectItem key={f.name} value={f.name}>
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OperatorSelect({ rule, onChange }: RuleCellProps) {
  const operators = Object.keys(OPERATOR_META) as RuleOperator[];

  function handleOperatorChange(operator: RuleOperator) {
    onChange({ ...rule, operator, value: undefined, values: undefined });
  }

  return (
    <Select value={rule.operator} onValueChange={(v) => handleOperatorChange(v as RuleOperator)}>
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {operators.map((op) => (
          <SelectItem key={op} value={op}>
            {OPERATOR_META[op].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ValueInput({ rule, schema, onChange }: RuleCellProps) {
  const meta = OPERATOR_META[rule.operator];

  const facetQuery = useMemo(
    () =>
      rule.typeName && rule.fieldKey
        ? Query.from(rule.typeName)
            .select({ value: column(rule.fieldKey) })
            .distinct()
            .orderby(asc(rule.fieldKey))
            .limit(50)
            .toString()
        : "",
    [rule.typeName, rule.fieldKey],
  );
  const { data: facetResult } = useCoordinatorQuery<{ value: string }>({
    query: facetQuery,
    enabled: !!facetQuery,
  });
  const options = useMemo(() => {
    if (!facetResult) return [];
    const result: { value: string; label: string }[] = [];
    for (let i = 0; i < facetResult.length; i++) {
      const row = facetResult[i];
      const v = String(row.value ?? "");
      if (v) result.push({ value: v, label: v });
    }
    return result;
  }, [facetResult]);

  if (!meta.needsValue && !meta.needsValues) return null;

  if (meta.needsValues) {
    return (
      <Input
        type="text"
        placeholder="a, b, c"
        value={(rule.values ?? []).join(", ")}
        onChange={(e) =>
          onChange({
            ...rule,
            values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
          })
        }
        className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent"
      />
    );
  }

  // For operators with a fixed placeholder (like pattern/datatype), use plain Input
  if (meta.placeholder) {
    return (
      <Input
        type="text"
        placeholder={meta.placeholder}
        value={String(rule.value ?? "")}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
        className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent"
      />
    );
  }

  // Mosaic-backed Combobox for value selection
  return (
    <Combobox
      options={options}
      value={String(rule.value ?? "")}
      onValueChange={(v) => onChange({ ...rule, value: v })}
      placeholder="Select value"
      searchPlaceholder="Search values..."
      emptyMessage="No values found"
      className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent"
    />
  );
}

interface StatusCellProps {
  result?: RuleResult;
}

export function StatusCell({ result }: StatusCellProps) {
  if (!result) return null;

  const violationCols = !result.passed && result.violations.length > 0
    ? Object.keys(result.violations[0])
    : [];

  const badge = (
    <Badge
      variant={result.passed ? "secondary" : "destructive"}
      className="text-xs cursor-pointer"
    >
      {result.passed ? (
        <CheckCircle2 size={12} className="mr-1" />
      ) : (
        <XCircle size={12} className="mr-1" />
      )}
      {result.passed
        ? "Pass"
        : result.violationCount === -1
          ? "Error"
          : `${result.violationCount.toLocaleString()} fail`}
    </Badge>
  );

  // No violations to show -- just render the badge
  if (result.passed || result.violationCount <= 0 || result.violations.length === 0) {
    return badge;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent className="w-auto max-w-[500px] p-3" align="start">
        <p className="text-xs text-muted-foreground mb-2">
          {result.violationCount.toLocaleString()} / {result.totalRows.toLocaleString()} rows
          ({(result.violationCount / result.totalRows * 100).toFixed(2)}%)
        </p>
        <div className="max-h-60 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {violationCols.map((c) => (
                  <TableHead key={c} className="text-xs h-7 whitespace-nowrap">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.violations.map((row, i) => (
                <TableRow key={i}>
                  {violationCols.map((c) => (
                    <TableCell key={c} className="text-xs py-0.5 whitespace-nowrap">
                      {row[c] == null ? "\u2014" : String(row[c])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {result.violationCount > result.violations.length && (
          <p className="text-xs text-muted-foreground mt-2">
            ...and {(result.violationCount - result.violations.length).toLocaleString()} more
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
