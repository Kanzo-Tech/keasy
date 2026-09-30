"use client";

import {
  createListCollection,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kanzo-tech/ui";
import { schemaOf, type JsonSchema } from "@/lib/api/spec";
import { getProviderIcon } from "@/lib/ui/provider-icons";

function resolve(s: JsonSchema): JsonSchema {
  return s.$ref ? schemaOf(s.$ref.replace("#/components/schemas/", "")) : s;
}

/** The discriminator of a tagged branch: the single-value `enum` on `kind`. */
const TAG = "kind";
const tagOf = (branch: JsonSchema) => branch.properties?.[TAG]?.enum?.[0] ?? "";

const branches = (schema: JsonSchema) => (schema.oneOf ? schema.oneOf : [schema]);
const branchOf = (schema: JsonSchema, kind: string) =>
  branches(schema).find((b) => tagOf(b) === kind) ?? branches(schema)[0];

interface FieldSpec {
  name: string;
  label: string;
  required: boolean;
  secret: boolean;
  integer: boolean;
  options?: string[];
  format?: string;
  help?: string;
  initial: string;
}

function fieldsOf(branch: JsonSchema, omit: readonly string[], tagged: boolean): FieldSpec[] {
  const required = new Set(branch.required ?? []);
  return Object.entries(branch.properties ?? {})
    .filter(([name]) => !(tagged && name === TAG) && !omit.includes(name))
    .map(([name, raw]) => {
      const s = resolve(raw);
      const types = [s.type ?? raw.type].flat();
      const initial = s.default ?? raw.default;
      return {
        name,
        label: name.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()),
        required: required.has(name) && initial === undefined,
        secret: raw.writeOnly === true || raw.format === "password",
        integer: types.includes("integer"),
        options: s.enum,
        format: raw.format,
        help: raw.description ?? s.description,
        initial: initial === undefined ? (s.enum?.[0] ?? "") : String(initial),
      };
    });
}

/** What the form edits: the branch picked and every field as typed. */
export interface SpecValues {
  kind: string;
  fields: Record<string, string>;
}

/**
 * The values a form over `schema` starts from: `current` — a response's view,
 * which never holds a secret — or each field's default.
 */
export function initialValues(schema: JsonSchema, current?: Record<string, unknown>): SpecValues {
  const tagged = !!schema.oneOf;
  const kind = tagged ? String(current?.[TAG] ?? tagOf(branches(schema)[0])) : "";
  const fields = Object.fromEntries(
    fieldsOf(branchOf(schema, kind), [], tagged).map((f) => [
      f.name,
      current?.[f.name] == null || f.secret ? f.initial : String(current[f.name]),
    ]),
  );
  return { kind, fields };
}

/** The request body the values make, or `null` while a required field is empty. */
export function toBody(
  schema: JsonSchema,
  values: SpecValues,
  omit: readonly string[] = [],
): Record<string, unknown> | null {
  const branch = branchOf(schema, values.kind);
  const tagged = !!schema.oneOf;
  const body: Record<string, unknown> = tagged ? { [TAG]: values.kind } : {};
  for (const f of fieldsOf(branch, omit, tagged)) {
    const raw = (values.fields[f.name] ?? "").trim();
    if (!raw) {
      if (f.required) return null;
      continue;
    }
    body[f.name] = f.integer ? Number(raw) : raw;
  }
  return body;
}

/**
 * One form for every credential and connection target: the fields, their
 * kinds, defaults, help and which of them are secrets all come from the
 * published contract. A `oneOf` gets a kind picker; a secret field is blank
 * when editing, because rotating means stating it again.
 */
export function SpecForm({
  schema,
  value,
  onChange,
  omit = [],
  editing = false,
}: {
  schema: JsonSchema;
  value: SpecValues;
  onChange: (value: SpecValues) => void;
  omit?: readonly string[];
  editing?: boolean;
}) {
  const choices = schema.oneOf ?? [];
  const fields = fieldsOf(branchOf(schema, value.kind), omit, !!schema.oneOf);
  const set = (name: string, v: string) =>
    onChange({ ...value, fields: { ...value.fields, [name]: v } });

  return (
    <>
      {choices.length > 1 && (
        <RadioGroup
          className="text-center *:flex-col *:items-center *:justify-center"
          columns={Math.min(choices.length, 4)}
          onValueChange={(details) => {
            if (details.value) onChange(initialValues(schema, { [TAG]: details.value }));
          }}
          value={value.kind}
        >
          {choices.map((branch) => {
            const Icon = getProviderIcon(tagOf(branch));
            return (
              <RadioGroupCard key={tagOf(branch)} value={tagOf(branch)}>
                <Icon className="size-6 shrink-0 text-muted-foreground" />
                <RadioGroupText>{branch.title ?? tagOf(branch)}</RadioGroupText>
              </RadioGroupCard>
            );
          })}
        </RadioGroup>
      )}

      {fields.map((f) => (
        <Field key={f.name} required={f.required || (f.secret && editing)}>
          <FieldLabel>
            {f.label}
            <FieldRequiredIndicator fallback="(optional)" />
          </FieldLabel>
          {f.help && <FieldDescription>{f.help}</FieldDescription>}
          <FieldInput field={f} editing={editing} onChange={(v) => set(f.name, v)} value={value.fields[f.name] ?? ""} />
        </Field>
      ))}
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  editing,
}: {
  field: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
}) {
  if (field.secret) {
    return (
      <PasswordInput>
        <PasswordInputGroup>
          <PasswordInputInput
            autoComplete="new-password"
            onChange={(e) => onChange(e.target.value)}
            placeholder={editing ? "Enter the new value to rotate" : undefined}
            value={value}
          />
          <PasswordInputTrigger />
        </PasswordInputGroup>
      </PasswordInput>
    );
  }
  if (field.options) {
    const collection = createListCollection({
      items: field.options.map((o) => ({ label: o.replaceAll("_", " "), value: o })),
    });
    return (
      <Select
        collection={collection}
        onValueChange={(details) => onChange(details.value[0] ?? "")}
        value={value ? [value] : []}
      >
        <SelectTrigger className="w-full">
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
    );
  }
  return (
    <Input
      className={field.format === "uri" ? "font-mono" : undefined}
      inputMode={field.integer ? "numeric" : undefined}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.initial || undefined}
      type={field.integer ? "number" : field.format === "uri" ? "url" : "text"}
      value={value}
    />
  );
}
