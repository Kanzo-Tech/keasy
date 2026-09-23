"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@kanzo-tech/ui";
import { Cloud } from "lucide-react";
import { toastError } from "@/lib/toast-error";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { PageShell } from "@/components/layout/page-shell";
import { FormField } from "@/components/shared/form-layout";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Button,
  createListCollection,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kanzo-tech/ui";
import { FormPageSkeleton } from "@/components/settings/form-page-skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";

export default function CatalogStoragePage() {
  const queryClient = useQueryClient();

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

  const [cloudAccountId, setCloudAccountId] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  // Sync form state once data arrives
  if (!initialized && !isLoading && config !== undefined) {
    if (config) {
      setCloudAccountId(config.cloud_account_id ?? "");
      setBaseUrl(config.base_url ?? "");
    }
    setInitialized(true);
  }

  // Ark's Select reads a collection rather than mapping children, so the options are
  // built once and the list below renders from the same object the machine holds.
  const accountCollection = useMemo(
    () =>
      createListCollection({
        items: (accounts ?? []).map((a) => ({ label: a.name, value: a.id })),
      }),
    [accounts],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      api.settings.saveCatalogStorage({
        cloud_account_id: cloudAccountId,
        base_url: baseUrl.trim(),
      }),
    onSuccess: async () => {
      toast.create({ title: "Catalog storage saved", type: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.catalogStorage });
    },
    onError: (err) => toastError(err, "Failed to save catalog storage"),
  });

  if (isLoading || !initialized) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  if (!accounts || accounts.length === 0) {
    return (
      <PageShell>
        <PageShell.Content>
          <EmptyState
            icon={Cloud}
            title="No cloud accounts"
            description="A member must add a cloud account (Settings → Cloud Accounts) before you can choose a catalog storage destination."
          />
        </PageShell.Content>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageShell.Content>
        <FormField label="Cloud Account" required>
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
        </FormField>

        <FormField label="Base URL" required description="Root path where catalog data will be stored (e.g. s3://my-bucket/catalog)">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="s3://my-bucket/catalog"
            className="h-8 text-sm"
          />
        </FormField>
      </PageShell.Content>

      <PageShell.Footer>
        <div />
        <Button
          size="sm"
          disabled={!cloudAccountId || !baseUrl.trim() || saveMutation.isPending || saveMutation.isSuccess}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
