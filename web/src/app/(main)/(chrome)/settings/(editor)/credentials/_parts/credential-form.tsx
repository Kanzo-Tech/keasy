"use client";

import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleIndicator,
  CollapsibleTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldRequiredIndicator,
  FieldSet,
  FieldTitle,
  GatedBadge,
  GatedContent,
  GatedRoot,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  SectionBody,
  SectionDescription,
  SectionFooter,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  SegmentGroup,
  Separator,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import * as z from "zod";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { schemaOf, type JsonSchema } from "@/lib/api/spec";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api, type Inputs, invalidate } from "@/lib/api/client";
import { CLOUDS, cloudOf, type Credential } from "@/lib/connections";
import { blocked } from "@/lib/permissions";
import { requiredName } from "@/lib/resource-name";
import { Blocked } from "@/components/blocked";
import { Boundary, Loading } from "@/components/boundary";
import { ProblemView } from "@/components/problem-view";
import { settled } from "@/lib/api/settled";

type Spec = Inputs["SecretSpec"];
type Kind = Spec["kind"];

/** One field of a credential kind, as the published contract states it. */
interface SpecField {
  name: string;
  label: string;
  required: boolean;
  /** Asked for in the main grid — required or defaulted; the rest wait under Advanced. */
  main: boolean;
  secret: boolean;
  help?: string;
  initial: string;
}

const SPEC = schemaOf("SecretSpec");

const branchOf = (kind: string): JsonSchema =>
  SPEC.oneOf?.find((b) => b.properties?.kind?.enum?.[0] === kind) ?? {};

/**
 * A kind's fields, the required ones first — names, defaults, help and which are secrets all come
 * from the contract.
 */
function fieldsOf(kind: string): SpecField[] {
  const branch = branchOf(kind);
  const required = new Set(branch.required ?? []);
  return Object.entries(branch.properties ?? {})
    .toSorted(([a], [b]) => Number(required.has(b)) - Number(required.has(a)))
    .filter(([name]) => name !== "kind")
    .map(([name, s]) => ({
      name,
      label: name.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()),
      required: required.has(name),
      main: required.has(name) || s.default !== undefined,
      secret: s.writeOnly === true || s.format === "password",
      help: s.description,
      initial: s.default === undefined ? "" : String(s.default),
    }));
}

/** A kind's fields as the form starts them: `current`'s — a response's view, which holds no secret — or each default. */
const valuesOf = (kind: string, current?: Record<string, unknown>) =>
  Object.fromEntries(
    fieldsOf(kind).map((f) => [f.name, current?.[f.name] == null || f.secret ? f.initial : String(current[f.name])]),
  );

/** The spec the values make: the kind, every field trimmed, an empty optional one left out. */
function specOf(kind: Kind, values: Record<string, string>): Spec {
  const body: Record<string, string> = { kind };
  for (const f of fieldsOf(kind)) {
    const value = (values[f.name] ?? "").trim();
    if (value) body[f.name] = value;
  }
  return body as unknown as Spec;
}

const errorText = (errors: ReadonlyArray<{ message: string } | undefined>) =>
  errors.map((issue) => issue?.message).join(", ");

const NAME = requiredName("Give the credential a name.");
const REQUIRED = z.string().trim().min(1, "Required.");

/** Adds a credential, or renames and rotates `name`. */
export function CredentialForm({ name }: { name?: string }) {
  if (!name) return <Form />;
  return (
    <Boundary
      fallback={
        <Loading>
          <SectionRoot>
            <SectionBody scale="page">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
            </SectionBody>
          </SectionRoot>
        </Loading>
      }
    >
      <Stored name={name} />
    </Boundary>
  );
}

function Stored({ name }: { name: string }) {
  const credential = settled($api.useSuspenseQuery("get", "/v1/secrets/{name}", { params: { path: { name } } }));
  return <Form credential={credential} />;
}

function Form({ credential }: { credential?: Credential }) {
  const router = useRouter();
  const done = async (title: string) => {
    toast.create({ title, type: "success" });
    await invalidate("/v1/secrets", "/v1/connections");
    router.push("/settings/credentials");
  };
  const create = $api.useMutation("post", "/v1/secrets", { onSuccess: () => done("Credential validated and saved") });
  const update = $api.useMutation("patch", "/v1/secrets/{name}", { onSuccess: () => done("Credential rotated") });
  const failure = create.error ?? update.error;
  const sending = create.isPending || update.isPending || create.isSuccess || update.isSuccess;

  const kind = (credential?.spec.kind ?? CLOUDS[0].methods[0].kind) as Kind;
  const form = useForm({
    defaultValues: {
      name: credential?.name ?? "",
      kind,
      spec: valuesOf(kind, credential?.spec),
      probe_url: "",
    },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      const name = value.name.trim();
      const spec = specOf(value.kind, value.spec);
      if (credential) {
        update.mutate({
          params: { path: { name: credential.name } },
          body: { name: name !== credential.name ? name : undefined, spec },
        });
      } else {
        create.mutate({ body: { name, spec, probe_url: value.probe_url.trim() || undefined } });
      }
    },
  });
  const pick = (next: Kind) => {
    form.setFieldValue("kind", next);
    form.setFieldValue("spec", valuesOf(next));
  };

  return (
    <SectionRoot asChild>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <SectionHeader className="mx-auto w-full max-w-3xl" scale="page">
          <SectionTitleGroup>
            <SectionTitle scale="page">{credential ? credential.name : "New credential"}</SectionTitle>
            <SectionDescription>
              The keys keasy uses to vend scoped access to your storage. They are checked before saving.
            </SectionDescription>
          </SectionTitleGroup>
        </SectionHeader>

        <SectionBody className="mx-auto w-full max-w-3xl" scale="page">
          {credential && credential.used_by.length > 0 && (
            <p className="text-muted-foreground text-sm">
              Rotating replaces the whole spec, and is saved only if every connection using it still
              validates: {credential.used_by.map((c) => <Badge className="ms-1" key={c} variant="outline">{c}</Badge>)}
            </p>
          )}

          <form.Field name="name" validators={{ onDynamic: NAME }}>
            {(field) => (
              <Field invalid={!field.state.meta.isValid} required>
                <FieldLabel>
                  Name
                  <FieldRequiredIndicator />
                </FieldLabel>
                <Input
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="production-s3"
                  value={field.state.value}
                />
                <FieldError>{errorText(field.state.meta.errors)}</FieldError>
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) => {
              const cloud = cloudOf(kind);
              const fields = fieldsOf(kind);
              const advanced = fields.filter((f) => !f.main);
              const spec = (f: SpecField) => (
                <form.Field
                  key={`${kind}.${f.name}`}
                  name={`spec.${f.name}`}
                  validators={f.required ? { onDynamic: REQUIRED } : undefined}
                >
                  {(field) => (
                    <Field invalid={!field.state.meta.isValid} required={f.required}>
                      <FieldLabel>
                        {f.label}
                        <FieldRequiredIndicator />
                      </FieldLabel>
                      {f.secret ? (
                        <PasswordInput>
                          <PasswordInputGroup>
                            <PasswordInputInput
                              autoComplete="new-password"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder={credential ? "Enter the new value to rotate" : undefined}
                              value={field.state.value}
                            />
                            <PasswordInputTrigger />
                          </PasswordInputGroup>
                        </PasswordInput>
                      ) : (
                        <Input
                          name={field.name}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          value={field.state.value}
                        />
                      )}
                      {f.help && <FieldDescription>{f.help}</FieldDescription>}
                      <FieldError>{errorText(field.state.meta.errors)}</FieldError>
                    </Field>
                  )}
                </form.Field>
              );

              return (
                <>
                  <FieldSet>
                    <FieldLegend variant="label">Cloud</FieldLegend>
                    <RadioGroup
                      className="text-center *:flex-col *:items-center *:justify-center"
                      columns={CLOUDS.length + 1}
                      onValueChange={(details) => {
                        const next = CLOUDS.find((c) => c.value === details.value);
                        if (next && next !== cloud) pick(next.methods[0].kind);
                      }}
                      value={cloud.value}
                    >
                      {CLOUDS.map((c) => (
                        <RadioGroupCard key={c.value} value={c.value}>
                          <RadioGroupText>{c.label}</RadioGroupText>
                          <span className="text-muted-foreground text-xs">{c.holds}</span>
                        </RadioGroupCard>
                      ))}
                      <GatedRoot aria-label="Google Cloud">
                        <GatedContent className="h-full *:h-full">
                          <RadioGroupCard className="flex-col items-center justify-center" disabled value="gcs">
                            <RadioGroupText>Google Cloud</RadioGroupText>
                            <span className="text-muted-foreground text-xs">Cloud Storage</span>
                          </RadioGroupCard>
                        </GatedContent>
                        <GatedBadge>Coming soon</GatedBadge>
                      </GatedRoot>
                    </RadioGroup>
                  </FieldSet>

                  <Separator />

                  <Field className="justify-between" orientation="horizontal">
                    <FieldTitle>Authentication</FieldTitle>
                    {cloud.methods.length > 1 ? (
                      <SegmentGroup
                        aria-label="Authentication"
                        className="shrink-0"
                        itemClassName="whitespace-nowrap"
                        onValueChange={(details) => details.value && pick(details.value as Kind)}
                        options={cloud.methods.map((m) => ({ value: m.kind, label: m.label }))}
                        value={kind}
                        variant="solid"
                      />
                    ) : (
                      <span className="text-muted-foreground text-sm">{cloud.methods[0].label}</span>
                    )}
                  </Field>

                  <FieldGroup columns={2}>
                    {fields.filter((f) => f.main).map(spec)}
                    {!credential && (
                      <form.Field name="probe_url">
                        {(field) => (
                          <Field>
                            <FieldLabel>
                              Test location
                              <FieldRequiredIndicator fallback="optional" />
                            </FieldLabel>
                            <Input
                              className="font-mono"
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder={`${cloud.scheme}my-bucket/`}
                              value={field.state.value}
                            />
                            <FieldDescription>Listed before saving.</FieldDescription>
                          </Field>
                        )}
                      </form.Field>
                    )}
                  </FieldGroup>

                  {advanced.length > 0 && (
                    <>
                      <Separator />
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-2 text-sm">
                          <CollapsibleIndicator />
                          <span className="font-medium">Advanced</span>
                          <span className="text-muted-foreground">
                            {advanced.map((f) => f.label).join(", ")}
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-4">
                          <FieldGroup columns={2}>{advanced.map(spec)}</FieldGroup>
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  )}
                </>
              );
            }}
          </form.Subscribe>

          {failure && <ProblemView error={failure} />}
        </SectionBody>

        <SectionFooter className="justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/credentials">Cancel</Link>
          </Button>
          <Blocked reason={credential && blocked(credential, "manage", "credential")}>
            <Button disabled={credential?.can.manage === false} isLoading={sending} size="sm" type="submit">
              {credential ? "Validate and rotate" : "Validate and save"}
            </Button>
          </Blocked>
        </SectionFooter>
        <form.Subscribe selector={(state) => state.isDirty}>
          {(dirty) => <UnsavedChangesGuard dirty={dirty && !credential && !sending} />}
        </form.Subscribe>
      </form>
    </SectionRoot>
  );
}
