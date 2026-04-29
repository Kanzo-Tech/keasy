"use client";

import type { ReactNode } from "react";
import { Controller, useForm, type DefaultValues, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretInput } from "@/components/ui/secret-input";
import type { FieldMeta } from "@/lib/api/connector-schemas";

interface SchemaFormProps<TSchema extends z.ZodTypeAny> {
  /** Zod schema, e.g. `connectorSchemas[kind].zod`. */
  zodSchema: TSchema;
  /** Field metadata derived from the OpenAPI schema. */
  fields: readonly FieldMeta[];
  /** Initial values. Missing keys default to "". */
  defaultValues?: Partial<z.input<TSchema>>;
  /** Called with the parsed (transformed) values on submit. */
  onSubmit: (values: z.output<TSchema>) => void;
  /** Optional content to render before the field group (e.g. kind picker, name input). */
  header?: ReactNode;
  /** Footer renderer — receives a `submit` handler bound to the form. */
  renderFooter?: (ctx: { submit: () => void; isSubmitting: boolean }) => ReactNode;
  /** Form id to wire an external submit button. */
  id?: string;
}

/**
 * Canonical schema-driven form: useForm + zodResolver + shadcn Field
 * primitive. Field switches between Input / SecretInput / Textarea based
 * on FieldMeta. Reference pattern: org-details-card.tsx.
 */
export function SchemaForm<TSchema extends z.ZodTypeAny>({
  zodSchema,
  fields,
  defaultValues,
  onSubmit,
  header,
  renderFooter,
  id,
}: SchemaFormProps<TSchema>) {
  // Build defaults: every field starts as "" unless explicitly provided.
  const computedDefaults = {
    ...Object.fromEntries(fields.map((f) => [f.name, ""])),
    ...(defaultValues ?? {}),
  } as DefaultValues<FieldValues>;

  const form = useForm<FieldValues>({
    // Generic TSchema doesn't satisfy zodResolver's input narrowing; cast
    // through unknown — runtime behavior is identical.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(zodSchema as any),
    defaultValues: computedDefaults,
  });

  return (
    <form
      id={id}
      onSubmit={form.handleSubmit(onSubmit as (values: FieldValues) => void)}
      className="space-y-6"
      noValidate
    >
      {header}
      <FieldGroup>
        {fields.map((meta) => (
          <Controller
            key={meta.name}
            control={form.control}
            name={meta.name}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`field-${meta.name}`}>
                  {meta.name.replace(/_/g, " ")}
                  {meta.required && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </FieldLabel>
                {meta.description && (
                  <FieldDescription>{meta.description}</FieldDescription>
                )}
                <FieldContent>
                  {meta.multiline ? (
                    <Textarea
                      id={`field-${meta.name}`}
                      placeholder={meta.example}
                      rows={4}
                      {...field}
                      value={field.value ?? ""}
                    />
                  ) : meta.secret ? (
                    <SecretInput
                      id={`field-${meta.name}`}
                      placeholder={meta.example}
                      {...field}
                      value={field.value ?? ""}
                    />
                  ) : (
                    <Input
                      id={`field-${meta.name}`}
                      placeholder={meta.example}
                      {...field}
                      value={field.value ?? ""}
                    />
                  )}
                </FieldContent>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        ))}
      </FieldGroup>
      {renderFooter?.({
        submit: () => form.handleSubmit(onSubmit as (values: FieldValues) => void)(),
        isSubmitting: form.formState.isSubmitting,
      })}
    </form>
  );
}
