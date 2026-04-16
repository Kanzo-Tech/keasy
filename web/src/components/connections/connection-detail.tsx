"use client";

import { useQuery } from "@tanstack/react-query";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getConnectorIcon } from "@/lib/connectors/connector-icons";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { MetaItem } from "@/components/shared/meta-item";
import { PageShell } from "@/components/layout/page-shell";

export function ConnectionDetail({ id }: { id: string }) {
  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: queryKeys.connections.detail(id),
    queryFn: () => api.connections.get(id),
  });

  const showSkeleton = useDelayedLoading(connLoading);

  if (connLoading) {
    return showSkeleton ? (
      <PageShell.Content>
        <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          {["Type", "Config"].map((label) => (
            <div key={label} className="min-w-0">
              <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
              <Skeleton loading className="block"><p className="text-sm">placeholder-value</p></Skeleton>
            </div>
          ))}
        </div>
      </PageShell.Content>
    ) : null;
  }

  if (!connection) {
    return <p className="text-muted-foreground">Connection not found.</p>;
  }

  const config = (connection.config ?? {}) as Record<string, unknown>;

  return (
    <PageShell.Content>
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Type</p>
          {(() => {
            const Icon = getConnectorIcon(connection.connector_type);
            return (
              <Badge variant="outline" className="gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {connection.connector_type}
              </Badge>
            );
          })()}
        </div>
        {Object.entries(config).map(([key, value]) => (
          <MetaItem
            key={key}
            label={key}
            value={value === true ? "\u2022\u2022\u2022\u2022" : String(value ?? "")}
            mono={value !== true}
          />
        ))}
      </div>
    </PageShell.Content>
  );
}
