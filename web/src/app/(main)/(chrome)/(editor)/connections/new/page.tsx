"use client";

import type { Role } from "@fossil-lang/types";
import { use } from "react";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldRequiredIndicator,
  FieldSet,
  Input,
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
  Skeleton,
} from "@kanzo-tech/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import * as z from "zod";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api, type Inputs } from "@/lib/api/client";
import { requiredName } from "@/lib/resource-name";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatsQuery } from "@/lib/fossil/checker";

type Holds = Inputs["ConnectionKind"];

/**
 * What a source connection holds, and the role fossil reads its files in; where graphs land is the
 * workspace's one sink, under Workspace storage.
 */
const HOLDS = [
  { value: "data", label: "Data", role: "data" },
  { value: "vocab", label: "Vocabulary", role: "schema" },
] as const satisfies readonly { value: Holds; label: string; role: Role }[];

const errorText = (errors: ReadonlyArray<{ message: string } | undefined>) =>
  errors.map((issue) => issue?.message).join(", ");

const NAME = requiredName("Give the connection a name.");
/** A storage URL, whole: the server says which stores it reaches and whether this one is the organization's. */
const LOCATION = z
  .string()
  .trim()
  .min(1, "Name the place: its storage URL, with a prefix if any.")
  .refine((location) => /^[a-z][a-z0-9+.-]*:\/\/[^/]/i.test(location), "Write the whole URL: s3://bucket/prefix/.");

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
      <Form holds={type} />
    </Boundary>
  );
}

function Form({ holds }: { holds: Holds }) {
  const router = useRouter();
  const create = $api.useMutation("post", "/v1/connections", {
    meta: { success: "Connection validated and created", invalidates: ["/v1/connections"] },
    onSuccess: (_, { body }) => router.push(`/connections?type=${body.target.kind}`),
  });
  const sending = create.isPending || create.isSuccess;
  // The formats it may hold are fossil's to say.
  const formats = settled(useSuspenseQuery(formatsQuery));
  const readIn = (role: Role) =>
    formats
      .filter((f) => f.kind === role || f.kind === "both")
      .map((f) => f.name)
      .join(", ");
  const form = useForm({
    defaultValues: { kind: holds as Holds, name: "", location: "" },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      create.mutate({
        body: {
          name: value.name.trim(),
          target: { kind: value.kind, direction: "source", url: value.location.trim() },
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
                  {HOLDS.map(({ value, label, role }) => (
                    <RadioGroupCard key={value} value={value}>
                      <RadioGroupText>{label}</RadioGroupText>
                      <span className="text-muted-foreground text-xs">{readIn(role)}</span>
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

            <form.Field name="location" validators={{ onDynamic: LOCATION }}>
              {(field) => (
                <Field invalid={!field.state.meta.isValid} required>
                  <FieldLabel>
                    Location
                    <FieldRequiredIndicator />
                  </FieldLabel>
                  <Input
                    className="font-mono"
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="s3://my-bucket/prefix/"
                    value={field.state.value}
                  />
                  <FieldDescription>
                    In your organization&apos;s storage: <code className="font-mono">s3://</code>,{" "}
                    <code className="font-mono">abfss://container@account.dfs.core.windows.net/</code> or{" "}
                    <code className="font-mono">gs://</code>
                  </FieldDescription>
                  <FieldError>{errorText(field.state.meta.errors)}</FieldError>
                </Field>
              )}
            </form.Field>
          </FieldGroup>

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
