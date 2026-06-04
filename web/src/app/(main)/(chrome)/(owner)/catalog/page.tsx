"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cloud } from "lucide-react";
import { toastError } from "@/lib/toast-error";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { PageShell } from "@/components/layout/page-shell";
import { FormField } from "@/components/shared/form-layout";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  const saveMutation = useMutation({
    mutationFn: () =>
      api.settings.saveCatalogStorage({
        cloud_account_id: cloudAccountId,
        base_url: baseUrl.trim(),
      }),
    onSuccess: async () => {
      toast.success("Catalog storage saved");
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
          <Select value={cloudAccountId} onValueChange={setCloudAccountId}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select a cloud account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
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
