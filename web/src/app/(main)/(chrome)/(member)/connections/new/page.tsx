"use client";

import { use, useMemo, useState } from "react";
import {
  Button,
  createListCollection,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@kanzo-tech/ui";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { initialValues, SpecForm, toBody } from "@/components/spec-form";
import { schemaOf } from "@/lib/api/spec";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api, type Inputs, invalidate } from "@/lib/api/client";
import { getProviderIcon } from "@/lib/ui/provider-icons";
import { toastError } from "@/lib/errors";

type Tab = "data" | "vocab";

/** A member's connection: a source — the sink is the owner's. */
export default function NewConnectionPage({ searchParams }: { searchParams: Promise<{ type?: Tab }> }) {
  const router = useRouter();
  const { type = "data" } = use(searchParams);
  const schema = schemaOf("StorageTarget");
  const omit = ["direction"];

  const { data: credentials = [] } = $api.useQuery("get", "/v1/credentials");
  const collection = useMemo(
    () =>
      createListCollection({
        items: credentials.map((c) => ({ label: c.name, value: c.name, kind: c.spec.kind })),
      }),
    [credentials],
  );

  const [name, setName] = useState("");
  const [credential, setCredential] = useState("");
  const [values, setValues] = useState(() =>
    initialValues(schema, { kind: type }),
  );
  const inner = toBody(schema, values, omit);

  const create = $api.useMutation("post", "/v1/connections", {
    onSuccess: async () => {
      toast.create({ title: "Connection validated and created", type: "success" });
      await invalidate("/v1/connections", "/v1/credentials");
      router.push(`/connections?type=${type}`);
    },
    onError: (err) => toastError(err, "The connection was not created"),
  });
  const creating = create.isPending || create.isSuccess;
  const dirty = !!(name || credential) && !creating;

  const submit = () => {
    if (!inner) return;
    const target = { ...inner, direction: "source" };
    create.mutate({
      body: { name: name.trim(), credential, target: target as unknown as Inputs["StorageTarget"] },
    });
  };

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <Field required>
          <FieldLabel>
            Name
            <FieldRequiredIndicator />
          </FieldLabel>
          <FieldDescription>Used as identifier in @references (e.g. @my-connection/file.csv)</FieldDescription>
          <Input onChange={(e) => setName(e.target.value)} placeholder="e.g. hr-data" value={name} />
        </Field>

        <Field required>
          <FieldLabel>
            Credential
            <FieldRequiredIndicator />
          </FieldLabel>
          {credentials.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No credentials yet.{" "}
              <Link className="text-primary hover:underline" href="/settings/credentials/new">
                Add one first
              </Link>
              .
            </p>
          ) : (
            <Select
              collection={collection}
              onValueChange={(details) => setCredential(details.value[0] ?? "")}
              value={credential ? [credential] : []}
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
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </Field>

        <SpecForm omit={omit} onChange={setValues} schema={schema} value={values} />
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button disabled={!name.trim() || !credential || !inner} isLoading={creating} onClick={submit} size="sm">
          Validate and create
        </Button>
      </SectionFooter>
      <UnsavedChangesGuard dirty={dirty} />
    </SectionRoot>
  );
}
