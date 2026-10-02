"use client";

import { useMemo, useState, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import {
  Button,
  cn,
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
  Show,
  useFilter,
} from "@kanzo-tech/ui";
import { useChartQuery } from "@kanzo-tech/ui/analytics";
import { distinctValuesQuery, isRuleComplete, OPERATOR_META, type Rule, type RuleOperator } from "./rule-engine";
import { relation } from "@/lib/fossil/corpus";
import { useCorpus } from "./corpus";
import { columnsOf, type TableStats } from "./field-stats";

/** The column a new rule starts on: the program's first field, where the table has one. */
const firstColumn = (table: TableStats) => table.fields[0]?.name ?? table.columns[0] ?? "";
const firstColumnOf = (tables: readonly TableStats[], name: string) => {
  const table = tables.find((t) => t.name === name);
  return table ? firstColumn(table) : "";
};

type Items = ListCollection<{ label: string; value: string }>;

const OPERATORS = Object.keys(OPERATOR_META) as RuleOperator[];
const OPERATOR_ITEMS = createListCollection({
  items: OPERATORS.map((op): { label: string; value: string } => ({ label: OPERATOR_META[op].label, value: op })),
});

/** One row of the sentence: a connective and the control that completes it. */
function RulePart({
  children,
  collection,
  label,
  mono = true,
  onChange,
  value,
}: {
  children?: ReactNode;
  collection: Items;
  label: string;
  /** The terms are the corpus's own words; the check is a plain English one. */
  mono?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-end text-muted-foreground text-xs">{label}</span>
      <Select
        className="min-w-0 flex-1"
        collection={collection}
        onValueChange={(details) => details.value[0] && onChange(details.value[0])}
        positioning={{ sameWidth: true }}
        value={value ? [value] : []}
      >
        <SelectTrigger aria-label={label} className={cn("h-8 w-full text-xs", mono && "font-mono")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {collection.items.map((item) => (
            <SelectItem item={item} key={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  );
}

/** What a value looks like for a check; the value's own facets fill the list where there are any. */
function ValueInput({ rule, onChange }: { rule: Omit<Rule, "id">; onChange: (updated: Omit<Rule, "id">) => void }) {
  const meta = OPERATOR_META[rule.operator];
  const { typeName, fieldKey } = rule;
  const { jobId } = useCorpus();
  const facets = useChartQuery({
    filterBy: null,
    deps: [typeName, fieldKey],
    query: () => (typeName && fieldKey ? distinctValuesQuery(fieldKey, relation(jobId, typeName)) : null),
  });
  const { contains } = useFilter({ sensitivity: "base" });
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const values = (facets.rows ?? []).map((row) => String(row.value ?? "")).filter((v) => v && contains(v, query));
    return createListCollection({ items: values.map((v) => ({ value: v, label: v })) });
  }, [facets.rows, query, contains]);
  const field = "h-8 w-full font-mono text-xs";

  if (meta.needsValues) {
    return (
      <Input
        aria-label="Value"
        className={field}
        onChange={(e) =>
          onChange({ ...rule, values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
        }
        placeholder="a, b, c"
        value={(rule.values ?? []).join(", ")}
      />
    );
  }
  if (meta.placeholder) {
    return (
      <Input
        aria-label="Value"
        className={field}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
        placeholder={meta.placeholder}
        value={String(rule.value ?? "")}
      />
    );
  }
  const selected = String(rule.value ?? "");
  return (
    <Combobox
      allowCustomValue
      collection={items}
      onInputValueChange={(d) => {
        setQuery(d.inputValue);
        onChange({ ...rule, value: d.inputValue });
      }}
      onValueChange={(d) => onChange({ ...rule, value: d.value[0] ?? "" })}
      value={selected ? [selected] : []}
    >
      <ComboboxInput aria-label="Value" className={field} placeholder="a value…" />
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

/**
 * The rule builder — menus in, rules out, read as the sentence a rule is: every X must have Y,
 * checked by Z, against a value. One check of a kind per field, because a second would be the same
 * rule twice.
 */
export function RuleBuilder({
  tables,
  rules,
  onAdd,
}: {
  tables: TableStats[];
  rules: Rule[];
  onAdd: (rule: Omit<Rule, "id">) => void;
}) {
  const first = tables[0];
  const [draft, setDraft] = useState<Omit<Rule, "id">>(() => ({
    typeName: first?.name,
    fieldKey: first ? firstColumn(first) : "",
    operator: "not_null",
  }));
  const entities = useMemo(
    () => createListCollection({ items: tables.map((t) => ({ label: t.name, value: t.name })) }),
    [tables],
  );
  const columns = columnsOf(tables, draft.typeName ?? "");
  const fieldItems = useMemo(
    () => createListCollection({ items: columns.map((name) => ({ label: name, value: name })) }),
    [columns],
  );

  const duplicate = rules.some(
    (r) => r.typeName === draft.typeName && r.fieldKey === draft.fieldKey && r.operator === draft.operator,
  );
  const complete = Boolean(draft.typeName && draft.fieldKey) && isRuleComplete({ id: "", ...draft });
  const meta = OPERATOR_META[draft.operator];
  const needsValue = meta.needsValue || meta.needsValues;

  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="font-medium text-muted-foreground text-xs">Add a rule</p>
      <div className="space-y-1.5 rounded-md border bg-muted p-2">
        <RulePart
          collection={entities}
          label="Every"
          onChange={(typeName) =>
            setDraft({ ...draft, typeName, fieldKey: firstColumnOf(tables, typeName), value: undefined, values: undefined })
          }
          value={draft.typeName ?? ""}
        />
        <RulePart
          collection={fieldItems}
          label="must have"
          onChange={(fieldKey) => setDraft({ ...draft, fieldKey, value: undefined, values: undefined })}
          value={draft.fieldKey}
        />
        <RulePart
          collection={OPERATOR_ITEMS}
          label="checked by"
          mono={false}
          onChange={(operator) =>
            setDraft({ ...draft, operator: operator as RuleOperator, value: undefined, values: undefined })
          }
          value={draft.operator}
        />
        <Show when={needsValue}>
          <div className="flex items-start gap-1.5">
            <span className="mt-1.5 w-16 shrink-0 text-end text-muted-foreground text-xs">against</span>
            <div className="min-w-0 flex-1">
              <ValueInput onChange={setDraft} rule={draft} />
            </div>
          </div>
        </Show>

        <Button
          className="w-full gap-1"
          disabled={!complete || duplicate}
          onClick={() => onAdd(draft)}
          size="sm"
          variant="secondary"
        >
          <PlusIcon className="size-3.5" />
          Add
        </Button>

        <Show when={duplicate}>
          <p className="text-warning text-xs">
            The rules already check “{meta.label.toLowerCase()}” on {draft.typeName} {draft.fieldKey}.
          </p>
        </Show>
      </div>
    </div>
  );
}
