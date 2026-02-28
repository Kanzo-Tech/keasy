"use client";

import { createElement } from "react";

import { toast } from "sonner";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchConnection,
  fetchSchema,
  fetchCloudAccounts,
  fetchConnectionFiles,
  fetchProviders,
} from "@/lib/api";
import { MetaItem } from "@/components/shared/meta-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getProviderIcon } from "@/lib/provider-icons";

function ProviderIcon({ icon }: { icon: string }) {
  return createElement(getProviderIcon(icon), {
    className: "h-4 w-4 text-muted-foreground",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConnectionDetail({ id }: { id: string }) {
  const { data, isLoading } = useSWR(`connection-edit-${id}`, () =>
    Promise.all([
      fetchConnection(id),
      fetchSchema(),
      fetchCloudAccounts(),
      fetchProviders(),
    ]),
  );
  const showSkeleton = useDelayedLoading(isLoading);

  const [connection, schema, accounts, providers] = data ?? [null, [], [], []];
  const account = connection?.cloud_account_id
    ? accounts.find((a) => a.id === connection.cloud_account_id)
    : null;
  const provider = account
    ? (schema.find((s) => s.id === account.provider_id) ?? null)
    : null;

  const { data: files = [], isLoading: filesLoading } = useSWR(
    connection && connection.location_type !== "local"
      ? `connection-files-${id}`
      : null,
    () => fetchConnectionFiles(id),
    { onError: () => toast.error("Failed to list files") },
  );

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
    <ScrollArea className="flex-1 min-h-0">
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
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Files</h3>
          {filesLoading ? (
            <div className="border rounded-md p-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="text-xs text-muted-foreground">No files found.</p>
          ) : (
            (() => {
              const supportedExts = providers
                .filter((p) =>
                  connection.kind === "data"
                    ? p.kind === "data" || p.kind === "both"
                    : p.kind === "schema" || p.kind === "both",
                )
                .flatMap((p) => p.extensions);
              const filtered =
                supportedExts.length > 0
                  ? files.filter((f) => {
                      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
                      return supportedExts.includes(ext);
                    })
                  : files;
              return filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No supported files found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Path</TableHead>
                      <TableHead className="w-24 text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((f) => (
                      <TableRow key={f.path}>
                        <TableCell className="font-mono text-xs">
                          {f.path}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground text-right">
                          {formatSize(f.size)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              );
            })()
          )}
        </div>
      )}
    </ScrollArea>
  );
}
