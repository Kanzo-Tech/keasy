"use client";

import { useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  Button,
  createListCollection,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  Item,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { ValidationBadge } from "@/components/validation-badge";
import { useDelayedLoading } from "@/lib/ui/use-delayed-loading";
import { $api, invalidate } from "@/lib/api/client";
import { type Connection, type Credential, storageOf } from "@/lib/connections";
import { toastError } from "@/lib/errors";

/** The workspace sink: the one storage connection where job output lands, the owner's alone. */
export default function CatalogStoragePage() {
  const credentials = $api.useQuery("get", "/v1/credentials", { params: { query: { purpose: "storage" } } });
  const connections = $api.useQuery("get", "/v1/connections", { params: { query: { purpose: "storage" } } });
  const isLoading = credentials.isLoading || connections.isLoading;
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <SectionRoot>
        <SectionBody scale="page">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </SectionBody>
      </SectionRoot>
    ) : null;
  }

  if (!credentials.data?.length) {
    return (
      <SectionRoot>
        <SectionBody scale="page">
          <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <KeyRound />
            </ItemMedia>
            <ItemTitle className="text-base">No storage credentials</ItemTitle>
            <ItemDescription>
              A member must add a storage credential (Settings → Credentials) before you can choose
              where job output is stored.
            </ItemDescription>
          </Item>
        </SectionBody>
      </SectionRoot>
    );
  }

  const sink = connections.data?.find((c) => storageOf(c)?.direction === "sink");
  return <Form credentials={credentials.data} key={sink?.name ?? "new"} sink={sink} />;
}

function Form({ credentials, sink }: { credentials: Credential[]; sink?: Connection }) {
  const [credential, setCredential] = useState(sink?.credential ?? "");
  const [url, setUrl] = useState((sink && storageOf(sink)?.url) ?? "");
  const collection = useMemo(
    () => createListCollection({ items: credentials.map((c) => ({ label: c.name, value: c.name })) }),
    [credentials],
  );

  const onSuccess = async () => {
    toast.create({ title: "Catalog storage validated and saved", type: "success" });
    await invalidate("/v1/connections", "/v1/credentials");
  };
  const onError = (err: unknown) => toastError(err, "Catalog storage was not saved");
  const create = $api.useMutation("post", "/v1/connections", { onSuccess, onError });
  const update = $api.useMutation("patch", "/v1/connections/{name}", { onSuccess, onError });
  const target = { storage: { url: url.trim(), kind: "data" as const, direction: "sink" as const } };

  const save = () =>
    sink
      ? update.mutate({ params: { path: { name: sink.name } }, body: { credential, target } })
      : create.mutate({ body: { name: "Workspace output", credential, target } });

  return (
    <SectionRoot>
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
            Where job output is written, one folder per job (e.g. s3://my-bucket/catalog). Saving
            writes and deletes a test object there.
          </FieldDescription>
          <Input
            className="font-mono"
            onChange={(e) => setUrl(e.target.value)}
            placeholder="s3://my-bucket/catalog"
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
