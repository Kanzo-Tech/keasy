"use client";

import { useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  Button,
  createListCollection,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  Field,
  FieldDescription,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { ValidationBadge } from "@/components/validation-badge";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { $api, invalidate } from "@/lib/api/client";
import type { Connection, Credential } from "@/lib/connections";
import { toastError } from "@/lib/errors";

/** Workspace storage: the sink, the one storage connection where job outputs land. An admin's. */
export default function WorkspaceStoragePage() {
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
      <WorkspaceStorage />
    </Boundary>
  );
}

function WorkspaceStorage() {
  const credentials = settled(
    $api.useSuspenseQuery("get", "/v1/secrets"),
  );
  const connections = settled(
    $api.useSuspenseQuery("get", "/v1/connections"),
  );

  if (credentials.length === 0) {
    return (
      <SectionRoot>
        <SectionBody scale="page">
          <EmptyRoot>
            <EmptyHeader>
              <EmptyIndicator variant="icon">
                <KeyRound />
              </EmptyIndicator>
              <EmptyTitle asChild>
                <h2>No storage credentials</h2>
              </EmptyTitle>
              <EmptyDescription>
                Add a storage credential (Settings → Credentials) before choosing where job outputs
                land.
              </EmptyDescription>
            </EmptyHeader>
          </EmptyRoot>
        </SectionBody>
      </SectionRoot>
    );
  }

  const sink = connections.find((c) => c.target.direction === "sink");
  return <Form credentials={credentials} key={sink?.name ?? "new"} sink={sink} />;
}

function Form({ credentials, sink }: { credentials: Credential[]; sink?: Connection }) {
  const [credential, setCredential] = useState(sink?.secret ?? "");
  const [url, setUrl] = useState(sink?.target.url ?? "");
  const collection = useMemo(
    () => createListCollection({ items: credentials.map((c) => ({ label: c.name, value: c.name })) }),
    [credentials],
  );

  const onSuccess = async () => {
    toast.create({ title: "Workspace storage validated and saved", type: "success" });
    await invalidate("/v1/connections", "/v1/secrets");
  };
  const onError = (err: unknown) => toastError(err, "Workspace storage was not saved");
  const create = $api.useMutation("post", "/v1/connections", { onSuccess, onError });
  const update = $api.useMutation("patch", "/v1/connections/{name}", { onSuccess, onError });
  const target = { url: url.trim(), kind: "data" as const, direction: "sink" as const };

  const save = () =>
    sink
      ? update.mutate({ params: { path: { name: sink.name } }, body: { secret: credential, target } })
      : create.mutate({ body: { name: "Workspace output", secret: credential, target } });

  return (
    <SectionRoot>
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>Workspace storage</SectionTitle>
          <SectionDescription>The bucket where job outputs land, for every job in this workspace.</SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        {sink && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            Last check <ValidationBadge report={sink.validation} />
          </div>
        )}
        <Field required>
          <FieldLabel>
            Credential
            <FieldRequiredIndicator />
          </FieldLabel>
          <Select
            collection={collection}
            onValueChange={(details) => setCredential(details.value[0] ?? "")}
            value={credential ? [credential] : []}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a storage credential" />
            </SelectTrigger>
            <SelectContent>
              {collection.items.map((item) => (
                <SelectItem item={item} key={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field required>
          <FieldLabel>
            Base URL
            <FieldRequiredIndicator />
          </FieldLabel>
          <FieldDescription>
            Where job output is written, one folder per job (e.g. s3://my-bucket/outputs). Saving
            writes and deletes a test object there.
          </FieldDescription>
          <Input
            className="font-mono"
            onChange={(e) => setUrl(e.target.value)}
            placeholder="s3://my-bucket/outputs"
            value={url}
          />
        </Field>
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button
          disabled={!credential || !url.trim()}
          isLoading={create.isPending || update.isPending}
          onClick={save}
          size="sm"
        >
          Validate and save
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
