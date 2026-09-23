"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { getProviderIcon } from "@/lib/provider-icons";
import type { ProviderSchema, FieldSchema, CloudAccountSummary } from "@/lib/types";

interface CloudAccountFormProps {
  schema: ProviderSchema[];
  account?: CloudAccountSummary | null;
  onSubmit: (data: {
    name: string;
    provider_id: string;
    auth_method?: string;
    fields: Record<string, string>;
  }) => void;
  isPending?: boolean;
}

export function CloudAccountForm({ schema, account, onSubmit, isPending = false }: CloudAccountFormProps) {
  const isEdit = !!account;
  const [name, setName] = useState(account?.name ?? "");
  const [selectedId, setSelectedId] = useState(account?.provider_id ?? "");
  const [authMethod, setAuthMethod] = useState(account?.auth_method ?? "");
  const [fieldsMap, setFieldsMap] = useState<Record<string, Record<string, string>>>(() =>
    account ? { [account.provider_id]: { ...account.fields } } : {},
  );
  const fields = fieldsMap[selectedId] ?? {};
  const selected = schema.find((s) => s.id === selectedId);
  const hasAuthMethods = (selected?.auth_methods.length ?? 0) > 0;

  const providerOptions = useMemo(
    () => schema.map((p) => ({ id: p.id, label: p.label, Icon: getProviderIcon(p.icon) })),
    [schema],
  );

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
    ? name !== (account?.name ?? "") && !isPending
    : !!(name || selectedId) && !isPending;

  function handleSubmit() {
    onSubmit({
      name: name.trim(),
      provider_id: selectedId,
      auth_method: hasAuthMethods ? authMethod : undefined,
      fields,
    });
  }

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content>
        {isEdit ? (
          <Badge variant="secondary" className="w-fit">{selected?.label ?? selectedId}</Badge>
        ) : (
          <RadioGroup
            className="text-center *:flex-col *:items-center *:justify-center"
            columns={3}
            onValueChange={(details) => {
              setFieldsMap({});
              setSelectedId(details.value ?? "");
              setAuthMethod("");
            }}
            value={selectedId}
          >
            {providerOptions.map((option) => (
              <RadioGroupCard key={option.id} value={option.id}>
                <option.Icon className="size-6 shrink-0 text-muted-foreground" />
                <RadioGroupText>{option.label}</RadioGroupText>
              </RadioGroupCard>
            ))}
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
                  className="w-full"
                  multiple={false}
                  onValueChange={(details) => {
                    if (details.value[0]) setAuthMethod(details.value[0]);
                  }}
                  value={authMethod ? [authMethod] : []}
                  variant="outline"
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
                  <PasswordInput>
                    <PasswordInputGroup>
                      <PasswordInputInput
                        hasStoredValue={isEdit}
                        onChange={(event) => setField(f.name, event.target.value)}
                        storedPlaceholder="Leave empty to keep current"
                        value={fields[f.name] ?? ""}
                      />
                      <PasswordInputTrigger />
                    </PasswordInputGroup>
                  </PasswordInput>
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
          disabled={!selectedId || !name.trim() || !fieldsValid || isPending}
          onClick={handleSubmit}
        >
          {isPending ? "Saving..." : isEdit ? "Save" : "Create"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
