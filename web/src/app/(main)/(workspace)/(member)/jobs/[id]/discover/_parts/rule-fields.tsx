"use client";

import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  createListCollection,
  Input,
  type ListCollection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useFilter,
} from "@kanzo-tech/ui";
import { useChartQuery } from "@kanzo-tech/ui/analytics";
import { distinctValuesQuery, OPERATOR_META, type Rule, type RuleOperator } from "@/lib/rule-engine";
import type { GraphSchema } from "@/lib/graph-schema";

interface RuleFieldProps {
  rule: Rule;
  schema: GraphSchema;
  onChange: (updated: Rule) => void;
}

const OPERATORS = Object.keys(OPERATOR_META) as RuleOperator[];
const OPERATOR_ITEMS = createListCollection({
  items: OPERATORS.map((op): { label: string; value: string } => ({ label: OPERATOR_META[op].label, value: op })),
});

/** Borderless, so a rule reads as one sentence rather than a row of form controls. */
const INLINE = "h-7 border-0 px-1 text-xs shadow-none hover:bg-accent";

function InlineSelect({
  items,
  value,
  placeholder,
  onValueChange,
}: {
  items: ListCollection<{ label: string; value: string }>;
  value: string;
  placeholder?: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select collection={items} onValueChange={(d) => onValueChange(d.value[0] ?? "")} value={value ? [value] : []}>
      <SelectTrigger className={INLINE}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.items.map((item) => (
          <SelectItem item={item} key={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EntitySelect({ rule, schema, onChange }: RuleFieldProps) {
  const items = useMemo(
    () => createListCollection({ items: schema.types.map((t) => ({ label: t.name, value: t.name })) }),
    [schema],
  );
  return (
    <InlineSelect
      items={items}
      onValueChange={(typeName) =>
        onChange({
          ...rule,
          typeName,
          fieldKey: schema.fieldsOf(typeName)[0]?.name ?? rule.fieldKey,
          value: undefined,
          values: undefined,
        })
      }
      placeholder="Entity"
      value={rule.typeName ?? schema.types[0]?.name ?? ""}
    />
  );
}

export function FieldSelect({ rule, schema, onChange }: RuleFieldProps) {
  const fields = schema.fieldsOf(rule.typeName ?? "");
  const items = useMemo(
    () => createListCollection({ items: fields.map((f) => ({ label: f.name, value: f.name })) }),
    [fields],
  );
  return (
    <InlineSelect
      items={items}
      onValueChange={(fieldKey) => onChange({ ...rule, fieldKey, value: undefined, values: undefined })}
      placeholder="Select field"
      value={rule.fieldKey}
    />
  );
}

export function OperatorSelect({ rule, onChange }: Omit<RuleFieldProps, "schema">) {
  return (
    <InlineSelect
      items={OPERATOR_ITEMS}
      onValueChange={(operator) =>
        onChange({ ...rule, operator: (operator || OPERATORS[0]) as RuleOperator, value: undefined, values: undefined })
      }
      value={rule.operator}
    />
  );
}

export function ValueInput({ rule, onChange }: Omit<RuleFieldProps, "schema">) {
  const meta = OPERATOR_META[rule.operator];
  const { typeName, fieldKey } = rule;
  const facets = useChartQuery({
    filterBy: null,
    deps: [typeName, fieldKey],
    query: () => (typeName && fieldKey ? distinctValuesQuery(fieldKey, typeName) : null),
  });
  // Ark's combobox reads a collection; the query text is held here and the collection derived
  // from it, so a facet list that arrives late is never stale.
  const { contains } = useFilter({ sensitivity: "base" });
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const values = (facets.rows ?? []).map((row) => String(row.value ?? "")).filter((v) => v && contains(v, query));
    return createListCollection({ items: values.map((v) => ({ value: v, label: v })) });
  }, [facets.rows, query, contains]);

  if (meta.needsValues) {
    return (
      <Input
        className={INLINE}
        onChange={(e) =>
          onChange({ ...rule, values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
        }
        placeholder="a, b, c"
        value={(rule.values ?? []).join(", ")}
      />
    );
  }
  if (!meta.needsValue) return null;
  if (meta.placeholder) {
    return (
      <Input
        className={INLINE}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
        placeholder={meta.placeholder}
        value={String(rule.value ?? "")}
      />
    );
  }

  const selected = String(rule.value ?? "");
  return (
    <Combobox
      collection={items}
      onInputValueChange={(d) => setQuery(d.inputValue)}
      onValueChange={(d) => onChange({ ...rule, value: d.value[0] ?? "" })}
      value={selected ? [selected] : []}
    >
      <ComboboxInput className={INLINE} placeholder="Select value" />
      <ComboboxContent>
        <ComboboxEmpty>No values found</ComboboxEmpty>
        {items.items.map((item) => (
          <ComboboxItem item={item} key={item.value}>
            {item.label}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}
