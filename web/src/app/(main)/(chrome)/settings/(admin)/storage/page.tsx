"use client";

import { useState } from "react";
import {
  Button,
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
  Skeleton,
} from "@kanzo-tech/ui";
import { ValidationBadge } from "@/components/validation-badge";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { $api } from "@/lib/api/client";
import type { Connection } from "@/lib/connections";

/** Workspace storage: the sink, the one storage connection where graph outputs land. An admin's. */
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
  const connections = settled($api.useSuspenseQuery("get", "/v1/connections"));
  const sink = connections.find((c) => c.target.direction === "sink");
  return <Form key={sink?.name ?? "new"} sink={sink} />;
}

function Form({ sink }: { sink?: Connection }) {
  const [url, setUrl] = useState(sink?.target.url ?? "");

  const meta = {
    success: "Workspace storage validated and saved",
    failure: "Workspace storage was not saved",
    invalidates: ["/v1/connections"],
  } as const;
  const create = $api.useMutation("post", "/v1/connections", { meta });
  const update = $api.useMutation("patch", "/v1/connections/{name}", { meta });
  const target = { url: url.trim(), kind: "data" as const, direction: "sink" as const };

  const save = () =>
    sink
      ? update.mutate({ params: { path: { name: sink.name } }, body: { target } })
      : create.mutate({ body: { name: "Workspace output", target } });

  return (
    <SectionRoot>
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>Workspace storage</SectionTitle>
          <SectionDescription>The bucket where graph outputs land, for every graph in this workspace.</SectionDescription>
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
            Base URL
            <FieldRequiredIndicator />
          </FieldLabel>
          <FieldDescription>
            Where graph output is written, one folder per graph (e.g. s3://my-bucket/outputs), in your
            organization&apos;s storage. Saving writes a test object there, <code>.keasy-validate</code>.
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
        <Button disabled={!url.trim()} isLoading={create.isPending || update.isPending} onClick={save} size="sm">
          Validate and save
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
