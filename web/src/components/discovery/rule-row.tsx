"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  Badge,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  createListCollection,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useFilter,
} from "@kanzo-tech/ui";
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

  const collection = useMemo(
    () =>
      createListCollection({
        items: schema.types.map((t) => ({ label: t.name, value: t.name })),
      }),
    [schema],
  );
  const value = rule.typeName ?? schema.types[0]?.name ?? "";

  return (
    <Select
      collection={collection}
      onValueChange={(details) => handleTypeChange(details.value[0] ?? "")}
      value={value ? [value] : []}
    >
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue placeholder="Entity" />
      </SelectTrigger>
      <SelectContent>
        {collection.items.map((t) => (
          <SelectItem item={t} key={t.value}>
            {t.label}
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

  const collection = useMemo(
    () =>
      createListCollection({
        items: typeFields.map((f) => ({ label: f.name, value: f.name })),
      }),
    [typeFields],
  );

  return (
    <Select
      collection={collection}
      onValueChange={(details) => handleFieldChange(details.value[0] ?? "")}
      value={rule.fieldKey ? [rule.fieldKey] : []}
    >
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue placeholder="Select field" />
      </SelectTrigger>
      <SelectContent>
        {collection.items.map((f) => (
          <SelectItem item={f} key={f.value}>
            {f.label}
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

  const collection = useMemo(
    () =>
      createListCollection({
        items: operators.map((op) => ({ label: OPERATOR_META[op].label, value: op })),
      }),
    [operators],
  );

  return (
    <Select
      collection={collection}
      onValueChange={(details) =>
        handleOperatorChange((details.value[0] ?? operators[0]) as RuleOperator)
      }
      value={[rule.operator]}
    >
      <SelectTrigger className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {collection.items.map((op) => (
          <SelectItem item={op} key={op.value}>
            {op.label}
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
  // Ark's combobox reads a collection; the query text is held here and the collection is
  // derived from it, so a facet list that arrives late is never stale.
  const { contains } = useFilter({ sensitivity: "base" });
  const [query, setQuery] = useState("");
  const collection = useMemo(() => {
    const items: { value: string; label: string }[] = [];
    for (const row of facetResult ?? []) {
      const v = String(row.value ?? "");
      if (v && contains(v, query)) items.push({ value: v, label: v });
    }
    return createListCollection({ items });
  }, [facetResult, query, contains]);

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

  // Mosaic-backed combobox for value selection
  const selected = String(rule.value ?? "");
  return (
    <Combobox
      collection={collection}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      onValueChange={(details) => onChange({ ...rule, value: details.value[0] ?? "" })}
      value={selected ? [selected] : []}
    >
      <ComboboxInput className="h-7 text-xs border-0 shadow-none px-1 rounded-sm hover:bg-accent" placeholder="Select value" />
      <ComboboxContent>
        <ComboboxEmpty>No values found</ComboboxEmpty>
        {collection.items.map((item) => (
          <ComboboxItem item={item} key={item.value}>
            {item.label}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
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
    <Popover positioning={{ placement: "bottom-start" }}>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent className="w-auto max-w-[500px] p-3">
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
