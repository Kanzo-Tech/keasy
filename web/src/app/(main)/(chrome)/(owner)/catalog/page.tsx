"use client";

import { useMemo, useState } from "react";
import { Cloud } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import type { Schemas } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";
import type { CloudAccountSummary } from "@/lib/types";

export default function CatalogStoragePage() {
  const { data: accounts, isLoading: loadingAccounts } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: api.cloud.list,
  });
  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: queryKeys.settings.catalogStorage,
    queryFn: api.settings.catalogStorage,
  });
  const isLoading = loadingAccounts || loadingConfig;
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

  if (!accounts?.length) {
    return (
      <SectionRoot>
        <SectionBody scale="page">
          <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Cloud />
            </ItemMedia>
            <ItemTitle className="text-base">No cloud accounts</ItemTitle>
            <ItemDescription>
              A member must add a cloud account (Settings → Cloud Accounts) before you can choose a
              catalog storage destination.
            </ItemDescription>
          </Item>
        </SectionBody>
      </SectionRoot>
    );
  }

  return <Form accounts={accounts} config={config ?? null} />;
}

function Form({
  accounts,
  config,
}: {
  accounts: CloudAccountSummary[];
  config: Schemas["CatalogStoragePayload"] | null;
}) {
  const queryClient = useQueryClient();
  const [cloudAccountId, setCloudAccountId] = useState(config?.cloud_account_id ?? "");
  const [baseUrl, setBaseUrl] = useState(config?.base_url ?? "");
  const accountCollection = useMemo(
    () => createListCollection({ items: accounts.map((a) => ({ label: a.name, value: a.id })) }),
    [accounts],
  );

  const save = useMutation({
    mutationFn: () =>
      api.settings.saveCatalogStorage({ cloud_account_id: cloudAccountId, base_url: baseUrl.trim() }),
    onSuccess: async () => {
      toast.create({ title: "Catalog storage saved", type: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.catalogStorage });
    },
    onError: (err) => toastError(err, "Failed to save catalog storage"),
  });

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <Field required>
          <FieldLabel>
            Cloud Account
            <FieldRequiredIndicator />
          </FieldLabel>
          <Select
            collection={accountCollection}
            onValueChange={(details) => setCloudAccountId(details.value[0] ?? "")}
            value={cloudAccountId ? [cloudAccountId] : []}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a cloud account" />
            </SelectTrigger>
            <SelectContent>
              {accountCollection.items.map((item) => (
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
            Root path where catalog data will be stored (e.g. s3://my-bucket/catalog)
          </FieldDescription>
          <Input
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="s3://my-bucket/catalog"
            value={baseUrl}
          />
        </Field>
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button
          disabled={!cloudAccountId || !baseUrl.trim()}
          isLoading={save.isPending}
          onClick={() => save.mutate()}
          size="sm"
        >
          Save
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
