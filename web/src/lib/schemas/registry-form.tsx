"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretInput } from "@/components/ui/secret-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";

import type { FieldDef, TypeDef } from "./field-def";

// ── Props ────────────────────────────────────────────────────────────────

interface RegistryFormProps {
  types: TypeDef[];
  typeLabel: string;
  typeDescription?: string;
  showName?: boolean;
  namePlaceholder?: string;
  nameDescription?: string;
  onSubmit: (data: { typeId: string; name: string; config: Record<string, string> }) => void;
  isPending?: boolean;
  isSuccess?: boolean;
  submitLabel?: string;
  backHref?: string;
  editTypeId?: string;
  initialConfig?: Record<string, string>;
  initialName?: string;
  storedSecretFields?: Set<string>;
}

// ── Component ────────────────────────────────────────────────────────────

const baseFormSchema = z.object({
  type_id: z.string().min(1),
  name: z.string(),
  config: z.record(z.string(), z.string()),
});

type FormValues = z.infer<typeof baseFormSchema>;

export function RegistryForm({
  types,
  typeLabel,
  typeDescription,
  showName = true,
  namePlaceholder = "e.g. my-resource",
  nameDescription,
  onSubmit,
  isPending = false,
  isSuccess = false,
  submitLabel = "Create",
  backHref,
  editTypeId,
  initialConfig,
  initialName,
  storedSecretFields,
}: RegistryFormProps) {
  const router = useRouter();
  const isEdit = !!editTypeId;

  const form = useForm<FormValues>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: {
      type_id: editTypeId ?? "",
      name: initialName ?? "",
      config: initialConfig ?? {},
    },
  });

  const selectedTypeId = form.watch("type_id");
  const typeDef = useMemo(
    () => types.find((t) => t.id === selectedTypeId),
    [types, selectedTypeId],
  );

  // Reset config when type changes (create mode)
  const prevTypeId = useRef(selectedTypeId);
  useEffect(() => {
    if (selectedTypeId !== prevTypeId.current) {
      prevTypeId.current = selectedTypeId;
      if (!isEdit) {
        const defaultConfig: Record<string, string> = {};
        if (typeDef?.authDiscriminator && typeDef.authOptions?.[0]) {
          defaultConfig[typeDef.authDiscriminator] = typeDef.authOptions[0].value;
        }
        form.setValue("config", defaultConfig);
      }
    }
  }, [selectedTypeId, isEdit, form, typeDef]);

  const configValues = form.watch("config") ?? {};
  const authValue = typeDef?.authDiscriminator ? configValues[typeDef.authDiscriminator] ?? "" : undefined;

  // Visible fields: filter by `when` condition
  const visibleFields = useMemo(
    () => (typeDef?.fields ?? []).filter((f) => {
      if (!f.when) return true;
      return configValues[f.when.field] === f.when.value;
    }),
    [typeDef, configValues],
  );

  function handleSubmit(values: FormValues) {
    // Validate config with the type's zod schema
    if (typeDef) {
      const result = typeDef.schema.safeParse(values.config);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const fieldName = issue.path[0];
          if (typeof fieldName === "string") {
            form.setError(`config.${fieldName}`, { message: issue.message });
          }
        }
        return;
      }
    }

    const config: Record<string, string> = {};
    for (const [key, value] of Object.entries(values.config)) {
      if (value && value.trim()) config[key] = value.trim();
    }
    onSubmit({ typeId: values.type_id, name: (values.name ?? "").trim(), config });
  }

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={form.formState.isDirty && !isPending} />
      <PageShell.Content>
        <form id="registry-form" onSubmit={form.handleSubmit(handleSubmit)}>
          <FieldGroup>
          {/* Type selector */}
          {!isEdit && (
            <Controller
              name="type_id"
              control={form.control}
              render={({ field, fieldState }) => (
                <FieldSet>
                  <FieldLegend variant="label">{typeLabel}</FieldLegend>
                  {typeDescription && <FieldDescription>{typeDescription}</FieldDescription>}
                  <RadioGroup
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                    className="grid grid-cols-2 gap-2"
                  >
                    {types.map((t) => {
                      const Icon = t.icon;
                      return (
                        <FieldLabel key={t.id} htmlFor={`type-${t.id}`}>
                          <Field orientation="horizontal" data-invalid={fieldState.invalid}>
                            <Icon className="h-5 w-5 shrink-0 opacity-70" />
                            <FieldContent>
                              <FieldTitle>{t.name}</FieldTitle>
                              <FieldDescription>{t.description}</FieldDescription>
                            </FieldContent>
                            <RadioGroupItem value={t.id} id={`type-${t.id}`} />
                          </Field>
                        </FieldLabel>
                      );
                    })}
                  </RadioGroup>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </FieldSet>
              )}
            />
          )}

          {/* Name */}
          {showName && (
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    placeholder={namePlaceholder}
                    className="h-8 text-sm"
                    aria-invalid={fieldState.invalid}
                  />
                  {nameDescription && <FieldDescription>{nameDescription}</FieldDescription>}
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}

          {/* Auth method toggle */}
          {typeDef?.authDiscriminator && typeDef.authOptions && (
            <ToggleGroup
              type="single"
              value={authValue}
              onValueChange={(v) => {
                if (v) form.setValue(`config.${typeDef.authDiscriminator}`, v, { shouldDirty: true });
              }}
              className="justify-start"
            >
              {typeDef.authOptions.map((opt) => (
                <ToggleGroupItem key={opt.value} value={opt.value} size="sm">
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}

          {/* Config fields */}
          {visibleFields.map((f) => (
            <ConfigField
              key={f.name}
              fieldDef={f}
              value={configValues[f.name] ?? ""}
              onChange={(v) => form.setValue(`config.${f.name}`, v, { shouldDirty: true })}
              error={form.formState.errors.config?.[f.name]?.message as string | undefined}
              hasStoredValue={storedSecretFields?.has(f.name)}
            />
          ))}
          </FieldGroup>
        </form>
      </PageShell.Content>
      <PageShell.Footer>
        {backHref ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back
          </Button>
        ) : <div />}
        <Button type="submit" form="registry-form" size="sm" disabled={isPending || isSuccess}>
          {isPending || isSuccess ? "Saving..." : submitLabel}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}

// ── Config field renderer ────────────────────────────────────────────────

function ConfigField({
  fieldDef,
  value,
  onChange,
  error,
  hasStoredValue,
}: {
  fieldDef: FieldDef;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hasStoredValue?: boolean;
}) {
  const isInvalid = !!error;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={`config-${fieldDef.name}`}>
        {fieldDef.label}
        {fieldDef.required && <span className="text-destructive ml-1">*</span>}
      </FieldLabel>
      {fieldDef.type === "secret" ? (
        <SecretInput
          id={`config-${fieldDef.name}`}
          value={value}
          hasStoredValue={hasStoredValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={fieldDef.placeholder ?? "Secret value"}
          className="h-8 text-sm font-mono"
          aria-invalid={isInvalid}
        />
      ) : fieldDef.type === "textarea" ? (
        <Textarea
          id={`config-${fieldDef.name}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fieldDef.placeholder}
          className="text-sm font-mono min-h-[80px]"
          aria-invalid={isInvalid}
        />
      ) : (
        <Input
          id={`config-${fieldDef.name}`}
          type={fieldDef.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fieldDef.placeholder}
          className="h-8 text-sm font-mono"
          aria-invalid={isInvalid}
        />
      )}
      {fieldDef.description && <FieldDescription>{fieldDef.description}</FieldDescription>}
      {isInvalid && <FieldError errors={[{ message: error }]} />}
    </Field>
  );
}
