"use client";

import { use, useMemo } from "react";
import {
  Button,
  createListCollection,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldRequiredIndicator,
  FieldSet,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import * as z from "zod";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api, type Inputs, invalidate } from "@/lib/api/client";
import { cloudOf, type Credential } from "@/lib/connections";
import { requiredName } from "@/lib/resource-name";
import { getProviderIcon } from "@/lib/ui/provider-icons";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

type Holds = Inputs["ConnectionKind"];

/** What a source connection holds; where graphs land is the workspace's one sink, under Workspace storage. */
const HOLDS = [
  { value: "data", label: "Data", hint: "CSV, Parquet, JSON" },
  { value: "vocab", label: "Vocabulary", hint: "ShEx, SHACL, RDF" },
] as const satisfies readonly { value: Holds; label: string; hint: string }[];

const errorText = (errors: ReadonlyArray<{ message: string } | undefined>) =>
  errors.map((issue) => issue?.message).join(", ");

const NAME = requiredName("Give the connection a name.");
const CREDENTIAL = z.string().min(1, "Choose the credential it signs with.");
const LOCATION = z
  .string()
  .trim()
  .min(1, "Name the bucket or container, and a prefix if any.")
  .refine((location) => !location.includes("://"), "Write it without the scheme.");

/** An editor's connection: a source. */
export default function NewConnectionPage({ searchParams }: { searchParams: Promise<{ type?: Holds }> }) {
  const { type = "data" } = use(searchParams);
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
      <Credentials holds={type} />
    </Boundary>
  );
}

function Credentials({ holds }: { holds: Holds }) {
  return <Form credentials={settled($api.useSuspenseQuery("get", "/v1/secrets"))} holds={holds} />;
}

function Form({ credentials, holds }: { credentials: Credential[]; holds: Holds }) {
  const router = useRouter();
  const create = $api.useMutation("post", "/v1/connections", {
    onSuccess: async (_, { body }) => {
      toast.create({ title: "Connection validated and created", type: "success" });
      await invalidate("/v1/connections", "/v1/secrets");
      router.push(`/connections?type=${body.target.kind}`);
    },
  });
  const sending = create.isPending || create.isSuccess;
  const collection = useMemo(
    () =>
      createListCollection({
        // A credential someone else owns is used once they share it (docs/design/permissions.md):
        // offered, disabled, with whom to ask.
        items: credentials.map((c) => ({
          label: c.name,
          value: c.name,
          kind: c.spec.kind,
          disabled: !c.can.use,
          owner: c.owner.name,
        })),
      }),
    [credentials],
  );
  const schemeOf = (credential: string) => {
    const found = credentials.find((c) => c.name === credential);
    return found ? cloudOf(found.spec.kind).scheme : undefined;
  };

  const form = useForm({
    defaultValues: { kind: holds as Holds, name: "", secret: "", location: "" },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      create.mutate({
        body: {
          name: value.name.trim(),
          secret: value.secret,
          target: { kind: value.kind, direction: "source", url: `${schemeOf(value.secret)}${value.location.trim()}` },
        },
      });
    },
  });

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
            <SectionTitle scale="page">New connection</SectionTitle>
            <SectionDescription>
              A place in your storage that programs read from, named so a program can say{" "}
              <code className="font-mono">@name/file.csv</code>.
            </SectionDescription>
          </SectionTitleGroup>
        </SectionHeader>

        <SectionBody className="mx-auto w-full max-w-3xl" scale="page">
          <form.Field name="kind">
            {(field) => (
              <FieldSet>
                <FieldLegend variant="label">What it holds</FieldLegend>
                <RadioGroup
                  className="text-center *:flex-col *:items-center *:justify-center"
                  columns={HOLDS.length}
                  name={field.name}
                  onValueChange={(details) => details.value && field.handleChange(details.value as Holds)}
                  value={field.state.value}
                >
                  {HOLDS.map(({ value, label, hint }) => (
                    <RadioGroupCard key={value} value={value}>
                      <RadioGroupText>{label}</RadioGroupText>
                      <span className="text-muted-foreground text-xs">{hint}</span>
                    </RadioGroupCard>
                  ))}
                </RadioGroup>
              </FieldSet>
            )}
          </form.Field>

          <FieldGroup columns={2}>
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
                    placeholder="hr-data"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    Programs write <code className="font-mono">@{field.state.value.trim() || "name"}/…</code>
                  </FieldDescription>
                  <FieldError>{errorText(field.state.meta.errors)}</FieldError>
                </Field>
              )}
            </form.Field>

            <form.Field name="secret" validators={{ onDynamic: CREDENTIAL }}>
              {(field) => (
                <Field invalid={!field.state.meta.isValid} required>
                  <FieldLabel>
                    Credential
                    <FieldRequiredIndicator />
                  </FieldLabel>
                  <Select
                    collection={collection}
                    name={field.name}
                    onOpenChange={(details) => {
                      if (!details.open) field.handleBlur();
                    }}
                    onValueChange={(details) => field.handleChange(details.value[0] ?? "")}
                    value={field.state.value ? [field.state.value] : []}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a credential" />
                    </SelectTrigger>
                    <SelectContent>
                      {collection.items.map((item) => {
                        const Icon = getProviderIcon(item.kind);
                        return (
                          <SelectItem item={item} key={item.value}>
                            <Icon className="size-3.5 opacity-60" />
                            {item.label}
                            {item.disabled && (
                              <span className="text-muted-foreground ms-auto text-xs">Ask {item.owner} to share it</span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {credentials.length === 0 && (
                    <FieldDescription>
                      None yet?{" "}
                      <Link className="text-primary hover:underline" href="/settings/credentials/new">
                        Add a credential
                      </Link>
                    </FieldDescription>
                  )}
                  <FieldError>{errorText(field.state.meta.errors)}</FieldError>
                </Field>
              )}
            </form.Field>
          </FieldGroup>

          <form.Subscribe selector={(state) => state.values.secret}>
            {(secret) => (
              <form.Field name="location" validators={{ onDynamic: LOCATION }}>
                {(field) => (
                  <Field disabled={!secret} invalid={!field.state.meta.isValid} required>
                    <FieldLabel>
                      Location
                      <FieldRequiredIndicator />
                    </FieldLabel>
                    <InputGroup>
                      {secret && (
                        <InputGroupAddon>
                          <InputGroupText className="font-mono">{schemeOf(secret)}</InputGroupText>
                        </InputGroupAddon>
                      )}
                      <InputGroupInput
                        className="font-mono"
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        placeholder="my-bucket/prefix/"
                        value={field.state.value}
                      />
                    </InputGroup>
                    <FieldError>{errorText(field.state.meta.errors)}</FieldError>
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          {create.error && <ProblemView error={create.error} />}
        </SectionBody>

        <SectionFooter className="justify-end gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/connections?type=${holds}`}>Cancel</Link>
          </Button>
          <Button isLoading={sending} size="sm" type="submit">
            Validate and create
          </Button>
        </SectionFooter>
        <form.Subscribe selector={(state) => state.isDirty}>
          {(dirty) => <UnsavedChangesGuard dirty={dirty && !sending} />}
        </form.Subscribe>
      </form>
    </SectionRoot>
  );
}
