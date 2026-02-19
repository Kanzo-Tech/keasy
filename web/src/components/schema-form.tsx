"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormField, FormActions } from "@/components/form-layout";
import { cn } from "@/lib/utils";
import type { ProviderSchema, FieldSchema } from "@/lib/types";

export interface SchemaFormProps {
  /** Options to choose from, rendered as icon cards. */
  schema: ProviderSchema[];
  /** Resolve an icon key to a component. */
  getIcon: (icon: string) => ComponentType<{ className?: string }>;
  /** Pre-selected option + field values (edit mode). */
  initial?: {
    provider_id: string;
    auth_method?: string;
    fields: Record<string, string>;
  };
  /** Lock the card selector (edit mode — shows a badge instead). */
  locked?: boolean;
  /** Additional fields rendered between the card selector and dynamic fields. */
  children?: React.ReactNode;
  /** Left-side action (e.g. Back button). If omitted, left side is empty. */
  secondaryAction?: React.ReactNode;
  /** Submit button label. */
  submitLabel?: string;
  /** Called on submit with the selected option, auth method, and field values. */
  onSubmit: (data: {
    provider_id: string;
    auth_method?: string;
    fields: Record<string, string>;
  }) => Promise<void>;
  /** External flag that, combined with internal field validation, controls submit button. */
  canSubmit?: boolean;
  /** When true, field values are preserved per-option when switching (tab-like behavior). */
  preserveFields?: boolean;
}

export function SchemaForm({
  schema,
  getIcon,
  initial,
  locked,
  children,
  secondaryAction,
  submitLabel = "Save",
  onSubmit,
  canSubmit = true,
  preserveFields,
}: SchemaFormProps) {
  const [selectedId, setSelectedId] = useState(initial?.provider_id ?? "");
  const [authMethod, setAuthMethod] = useState(initial?.auth_method ?? "");
  const [fieldsMap, setFieldsMap] = useState<Record<string, Record<string, string>>>(() =>
    initial?.provider_id && initial?.fields
      ? { [initial.provider_id]: { ...initial.fields } }
      : {},
  );
  const [saving, setSaving] = useState(false);

  const fields = fieldsMap[selectedId] ?? {};

  const selected = schema.find((s) => s.id === selectedId);
  const hasAuthMethods = (selected?.auth_methods.length ?? 0) > 0;

  useEffect(() => {
    if (selected && hasAuthMethods && !authMethod) {
      setAuthMethod(selected.auth_methods[0].name);
    }
  }, [selected, hasAuthMethods, authMethod]);

  const activeMethodFields: FieldSchema[] = hasAuthMethods
    ? (selected?.auth_methods.find((a) => a.name === authMethod)?.fields ?? [])
    : [];
  const allActiveFields = [...(selected?.common_fields ?? []), ...activeMethodFields];

  useEffect(() => {
    if (!selected) return;
    const currentFields = fieldsMap[selectedId] ?? {};
    const defaults: Record<string, string> = {};
    for (const f of allActiveFields) {
      if (f.default_value && !currentFields[f.name]) {
        defaults[f.name] = f.default_value;
      }
    }
    if (Object.keys(defaults).length > 0) {
      setFieldsMap((prev) => ({
        ...prev,
        [selectedId]: { ...defaults, ...(prev[selectedId] ?? {}) },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, authMethod]);

  function setField(name: string, value: string) {
    setFieldsMap((prev) => ({
      ...prev,
      [selectedId]: { ...(prev[selectedId] ?? {}), [name]: value },
    }));
  }

  const fieldsValid = allActiveFields
    .filter((f) => !f.optional)
    .every((f) => {
      const val = fields[f.name];
      if (f.secret && locked) return true;
      return (val && val.trim()) || f.default_value;
    });

  async function handleSubmit() {
    setSaving(true);
    try {
      await onSubmit({
        provider_id: selectedId,
        auth_method: hasAuthMethods ? authMethod : undefined,
        fields,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {locked ? (
        <Badge variant="secondary" className="w-fit">{selected?.label ?? selectedId}</Badge>
      ) : (
        <RadioGroup
          value={selectedId}
          onValueChange={(v) => {
            if (!preserveFields) {
              setFieldsMap({});
            }
            setSelectedId(v);
            setAuthMethod("");
          }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
        >
          {schema.map((p) => {
            const Icon = getIcon(p.icon);
            return (
              <Label
                key={p.id}
                htmlFor={`schema-${p.id}`}
                className={cn(
                  "flex flex-col items-center gap-2 py-4 px-3 rounded-md border cursor-pointer transition-colors",
                  selectedId === p.id
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <RadioGroupItem value={p.id} id={`schema-${p.id}`} className="sr-only" />
                <Icon className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs font-medium">{p.label}</span>
              </Label>
            );
          })}
        </RadioGroup>
      )}

      {children}

      {selected && (
        <>
          {hasAuthMethods && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Auth Method</Label>
              <ToggleGroup
                type="single"
                value={authMethod}
                onValueChange={(v) => { if (v) setAuthMethod(v); }}
                className="w-full"
              >
                {selected.auth_methods.map((a) => (
                  <ToggleGroupItem
                    key={a.name}
                    value={a.name}
                    className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {a.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {allActiveFields.map((f) => (
            <FormField key={f.name} label={f.label} optional={f.optional}>
              <Input
                type={f.secret ? "password" : "text"}
                value={fields[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                autoComplete="off"
                placeholder={f.secret && locked ? "Leave empty to keep current" : undefined}
                className="h-8 text-sm"
              />
            </FormField>
          ))}
        </>
      )}

      <FormActions>
        {secondaryAction ?? <div />}
        <Button
          size="sm"
          disabled={!selectedId || !fieldsValid || !canSubmit || saving}
          onClick={handleSubmit}
        >
          {saving ? "Saving..." : submitLabel}
        </Button>
      </FormActions>
    </div>
  );
}
