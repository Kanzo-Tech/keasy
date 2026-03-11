"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { getProviderIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import type { ProviderSchema, FieldSchema, CloudAccountSummary } from "@/lib/types";

interface CloudAccountFormProps {
  schema: ProviderSchema[];
  account?: CloudAccountSummary | null;
  onSubmit: (data: {
    name: string;
    provider_id: string;
    auth_method?: string;
    fields: Record<string, string>;
  }) => Promise<void>;
}

export function CloudAccountForm({ schema, account, onSubmit }: CloudAccountFormProps) {
  const isEdit = !!account;
  const [name, setName] = useState(account?.name ?? "");
  const [selectedId, setSelectedId] = useState(account?.provider_id ?? "");
  const [authMethod, setAuthMethod] = useState(account?.auth_method ?? "");
  const [fieldsMap, setFieldsMap] = useState<Record<string, Record<string, string>>>(() =>
    account ? { [account.provider_id]: { ...account.fields } } : {},
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

  function setField(fieldName: string, value: string) {
    setFieldsMap((prev) => ({
      ...prev,
      [selectedId]: { ...(prev[selectedId] ?? {}), [fieldName]: value },
    }));
  }

  const fieldsValid = allActiveFields
    .filter((f) => !f.optional)
    .every((f) => {
      const val = fields[f.name];
      if (f.secret && isEdit) return true;
      return (val && val.trim()) || f.default_value;
    });

  const isDirty = isEdit
    ? name !== (account?.name ?? "") && !saving
    : !!(name || selectedId) && !saving;

  async function handleSubmit() {
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        provider_id: selectedId,
        auth_method: hasAuthMethods ? authMethod : undefined,
        fields,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content>
        {isEdit ? (
          <Badge variant="secondary" className="w-fit">{selected?.label ?? selectedId}</Badge>
        ) : (
          <RadioGroup
            value={selectedId}
            onValueChange={(v) => {
              setFieldsMap({});
              setSelectedId(v);
              setAuthMethod("");
            }}
            className="grid grid-cols-3 gap-3"
          >
            {schema.map((p) => {
              const Icon = getProviderIcon(p.icon);
              return (
                <Label
                  key={p.id}
                  htmlFor={`provider-${p.id}`}
                  className={cn(
                    "flex flex-col items-center justify-center text-center gap-2 py-4 px-3 rounded-md border cursor-pointer transition-colors",
                    selectedId === p.id
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <RadioGroupItem value={p.id} id={`provider-${p.id}`} className="sr-only" />
                  <Icon className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs font-medium">{p.label}</span>
                </Label>
              );
            })}
          </RadioGroup>
        )}

        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production Azure"
            className="h-8 text-sm"
          />
        </FormField>

        {selected && (
          <>
            {hasAuthMethods && (
              <FormField label="Auth Method">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={authMethod}
                  onValueChange={(v) => { if (v) setAuthMethod(v); }}
                  className="w-full"
                >
                  {selected.auth_methods.map((a) => (
                    <ToggleGroupItem key={a.name} value={a.name} className="flex-1">
                      {a.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FormField>
            )}

            {allActiveFields.map((f) => (
              <FormField key={f.name} label={f.label} optional={f.optional}>
                {f.secret ? (
                  <SecretInput
                    hasStoredValue={isEdit}
                    value={fields[f.name] ?? ""}
                    onChange={(e) => setField(f.name, e.target.value)}
                    className="h-8 text-sm"
                  />
                ) : (
                  <Input
                    value={fields[f.name] ?? ""}
                    onChange={(e) => setField(f.name, e.target.value)}
                    className="h-8 text-sm"
                  />
                )}
              </FormField>
            ))}
          </>
        )}
      </PageShell.Content>

      <PageShell.Footer>
        <div />
        <Button
          size="sm"
          disabled={!selectedId || !name.trim() || !fieldsValid || saving}
          onClick={handleSubmit}
        >
          {saving ? "Saving..." : isEdit ? "Save" : "Create"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
