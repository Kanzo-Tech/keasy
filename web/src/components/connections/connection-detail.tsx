"use client";

import { createElement } from "react";

import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { MetaItem } from "@/components/shared/meta-item";
import { PageShell } from "@/components/layout/page-shell";
import { FileExplorer } from "@/components/connections/file-explorer";
import { getProviderIcon } from "@/lib/provider-icons";

function ProviderIcon({ icon }: { icon: string }) {
  return createElement(getProviderIcon(icon), {
    className: "h-4 w-4 text-muted-foreground",
  });
}

export function ConnectionDetail({ id }: { id: string }) {
  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: queryKeys.connections.detail(id),
    queryFn: () => api.connections.get(id),
  });
  const { data: schema = [], isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.settings.schema,
    queryFn: () => api.settings.schema(),
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: () => api.cloud.list(),
  });
  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: queryKeys.settings.providers,
    queryFn: () => api.settings.providers(),
  });

  const isLoading = connLoading || schemaLoading || accountsLoading || providersLoading;
  const showSkeleton = useDelayedLoading(isLoading);

  const account = connection?.cloud_account_id
    ? accounts.find((a) => a.id === connection.cloud_account_id)
    : null;
  const provider = account
    ? (schema.find((s) => s.id === account.provider_id) ?? null)
    : null;

  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: queryKeys.connections.files(id),
    queryFn: () => api.connections.files(id),
    enabled: !!(connection && connection.location_type !== "local"),
    meta: { onError: () => toast.error("Failed to list files") },
  });

  if (isLoading) {
    return showSkeleton ? (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : null;
  }

  if (!connection) {
    return <p className="text-muted-foreground">Connection not found.</p>;
  }

  return (
    <PageShell.Content>
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        {connection.location_type === "cloud" && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Cloud Account</p>
            <div className="flex items-center gap-2">
              {provider && <ProviderIcon icon={provider.icon} />}
              <p className="text-sm font-medium">
                {account?.name ?? connection.cloud_account_id}
              </p>
            </div>
          </div>
        )}
        <MetaItem label="URL" value={connection.url} mono />
        <MetaItem
          label="Location"
          value={connection.location_type === "cloud" ? "Cloud" : "Local"}
        />
      </div>

      {connection.location_type === "cloud" && (
        <FileExplorer
          connectionName={connection.name}
          connectionKind={connection.kind}
          files={files}
          isLoading={filesLoading}
          providers={providers}
        />
      )}
    </PageShell.Content>
  );
}
