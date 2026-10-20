"use client";

import { useMemo } from "react";
import {
  Button,
  createListCollection,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
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
} from "@kanzo-tech/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import * as z from "zod";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api } from "@/lib/api/client";
import { cloudOf, type Credential } from "@/lib/connections";
import { requiredName } from "@/lib/resource-name";
import { getProviderIcon } from "@/lib/ui/provider-icons";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

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
      <Credentials />
    </Boundary>
  );
}

function Credentials() {
  return <Form credentials={settled($api.useSuspenseQuery("get", "/v1/secrets"))} />;
}

function Form({ credentials }: { credentials: Credential[] }) {
  const router = useRouter();
  const create = $api.useMutation("post", "/v1/connections", {
    meta: { success: "Connection validated and created", invalidates: ["/v1/connections", "/v1/secrets"] },
    onSuccess: () => router.push("/connections"),
  });
  const sending = create.isPending || create.isSuccess;
  const collection = useMemo(
    () =>
      createListCollection({
        // A credential someone else owns is theirs and an admin's (docs/design/permissions.md):
        // offered, disabled, saying whose.
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
    defaultValues: { name: "", secret: "", location: "" },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      create.mutate({
        body: {
          name: value.name.trim(),
          secret: value.secret,
          target: { direction: "source", url: `${schemeOf(value.secret)}${value.location.trim()}` },
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
                              <span className="text-muted-foreground ms-auto text-xs">Only {item.owner} or an admin can use it</span>
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
