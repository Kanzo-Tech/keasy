"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { RadioCardGroup } from "@/components/shared/radio-card-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Textarea } from "@/components/ui/textarea";

import { api } from "@/lib/api";
import { connectorSchemas, type ConnectorKind } from "@/lib/api/connector-schemas";
import type { Schemas } from "@/lib/api/client";
import { getConnectorIcon } from "@/lib/connectors/connector-icons";
import { toastError } from "@/lib/toast-error";

type ConnectorKindInfo = Schemas["ConnectorKindInfo"];

interface ConnectorFormProps {
  kinds: ConnectorKindInfo[];
  /** Locked kind (used in edit flow); when set, the kind picker is hidden. */
  fixedKind?: ConnectorKind;
  /** Initial values when editing. */
  initialName?: string;
  initialConfig?: Record<string, unknown>;
  onSubmit: (data: {
    kind: ConnectorKind;
    name: string;
    config: Schemas["ConnectorConfig"];
  }) => void;
  isPending?: boolean;
  submitLabel?: string;
  backHref?: string;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok" }
  | { status: "error"; message: string };

const NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i;

export function ConnectorForm({
  kinds,
  fixedKind,
  initialName = "",
  initialConfig,
  onSubmit,
  isPending,
  submitLabel = "Create",
  backHref,
}: ConnectorFormProps) {
  const router = useRouter();
  const [selectedKind, setSelectedKind] = useState<ConnectorKind>(
    fixedKind ?? ((kinds[0]?.kind as ConnectorKind | undefined) ?? "s3"),
  );
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const radioOptions = useMemo(
    () =>
      kinds.map((k) => ({
        value: k.kind,
        label: k.name,
        icon: getConnectorIcon(k.kind),
      })),
    [kinds],
  );

  return (
    <>
      <PageShell.Header
        title={fixedKind ? "Edit Connection" : "New Connection"}
        actions={
          backHref && (
            <Button variant="ghost" size="icon" onClick={() => router.push(backHref)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )
        }
      />
      <PageShell.Content>
        <div className="mx-auto w-full max-w-xl space-y-6 pb-2">
          {!fixedKind && (
            <FieldSet>
              <FieldLegend>Connector Type</FieldLegend>
              <FieldDescription>
                Choose the type of storage to connect to
              </FieldDescription>
              <RadioCardGroup
                name="kind"
                value={selectedKind}
                onValueChange={(v) => {
                  setSelectedKind(v as ConnectorKind);
                  setTest({ status: "idle" });
                }}
                options={radioOptions}
              />
            </FieldSet>
          )}

          <KindFormBody
            key={selectedKind}
            kind={selectedKind}
            initialName={initialName}
            initialConfig={initialConfig}
            isPending={isPending}
            test={test}
            setTest={setTest}
            submitLabel={submitLabel}
            backHref={backHref}
            onSubmit={onSubmit}
          />
        </div>
      </PageShell.Content>
    </>
  );
}

interface KindFormBodyProps {
  kind: ConnectorKind;
  initialName: string;
  initialConfig?: Record<string, unknown>;
  isPending?: boolean;
  test: TestState;
  setTest: (s: TestState) => void;
  submitLabel: string;
  backHref?: string;
  onSubmit: (data: {
    kind: ConnectorKind;
    name: string;
    config: Schemas["ConnectorConfig"];
  }) => void;
}

function KindFormBody({
  kind,
  initialName,
  initialConfig,
  isPending,
  test,
  setTest,
  submitLabel,
  backHref,
  onSubmit,
}: KindFormBodyProps) {
  const router = useRouter();
  const schema = connectorSchemas[kind];

  // Extend the codegen schema with `name` validation so RHF's resolver
  // checks both in one pass and the parsed values keep `name`.
  const extended = useMemo(
    () =>
      schema.zod.extend({
        name: z
          .string()
          .min(1, "Name is required")
          .regex(NAME_PATTERN, "Use letters, digits, hyphens, or underscores only"),
      }),
    [schema],
  );

  const defaults: FieldValues = useMemo(() => {
    const base: FieldValues = { name: initialName, kind };
    for (const f of schema.fields) {
      base[f.name] = (initialConfig?.[f.name] as string | undefined) ?? "";
    }
    return base;
  }, [initialName, initialConfig, kind, schema.fields]);

  const form = useForm<FieldValues>({
    // The codegen schema is a discriminated union per kind; RHF uses
    // a flat FieldValues record, so we cast through unknown.
    resolver: zodResolver(extended) as unknown as ReturnType<typeof zodResolver>,
    defaultValues: defaults,
  });

  function buildPayload(values: FieldValues) {
    const { name, ...rest } = values;
    const cleaned = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""),
    );
    return {
      name: String(name ?? "").trim(),
      config: cleaned as Schemas["ConnectorConfig"],
    };
  }

  async function handleTest(values: FieldValues) {
    const { config } = buildPayload(values);
    setTest({ status: "testing" });
    try {
      await api.connections.testConfig(config);
      setTest({ status: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection test failed";
      setTest({ status: "error", message: msg });
      toastError(e, "Connection test failed");
    }
  }

  function handleSave(values: FieldValues) {
    const { name, config } = buildPayload(values);
    onSubmit({ kind, name, config });
  }

  return (
    <>
      <form
        id="connector-form"
        onSubmit={form.handleSubmit(handleSave)}
        className="space-y-6"
        noValidate
      >
        <FieldGroup>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="conn-name">
                  Name<span className="text-destructive ml-0.5">*</span>
                </FieldLabel>
                <FieldDescription>
                  Used as identifier in @references (e.g. @my-connection/file.csv)
                </FieldDescription>
                <FieldContent>
                  <Input
                    id="conn-name"
                    placeholder="e.g. hr-data"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FieldContent>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          {schema.fields.map((meta) => (
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
      </form>

      <PageShell.Footer>
        <div className="flex items-center gap-3 text-sm">
          {test.status === "ok" && (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-4 w-4" /> Connection OK
            </span>
          )}
          {test.status === "error" && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <X className="h-4 w-4" /> {test.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {backHref && (
            <Button variant="ghost" onClick={() => router.push(backHref)}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={test.status === "testing"}
            onClick={() => form.handleSubmit(handleTest)()}
          >
            {test.status === "testing" ? "Testing..." : "Test"}
          </Button>
          <Button type="submit" form="connector-form" disabled={isPending}>
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </div>
      </PageShell.Footer>
    </>
  );
}
