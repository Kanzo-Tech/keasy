"use client";

import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
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
import { $api } from "@/lib/api/client";
import { requiredName } from "@/lib/resource-name";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";

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
export default function NewConnectionPage() {
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
      <Form />
    </Boundary>
  );
}

function Form() {
  const router = useRouter();
  const create = $api.useMutation("post", "/v1/connections", {
    meta: { success: "Connection validated and created", invalidates: ["/v1/connections"] },
    onSuccess: () => router.push("/connections"),
  });
  const sending = create.isPending || create.isSuccess;
  const form = useForm({
    defaultValues: { name: "", location: "" },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      create.mutate({
        body: {
          name: value.name.trim(),
          target: { direction: "source", url: value.location.trim() },
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
              A place in your storage that programs read from — its data, and any vocabulary beside it —
              named so a program can say <code className="font-mono">@name/file.csv</code>.
            </SectionDescription>
          </SectionTitleGroup>
        </SectionHeader>

        <SectionBody className="mx-auto w-full max-w-3xl" scale="page">
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
            <Link href="/connections">Cancel</Link>
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
