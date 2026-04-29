"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetaGrid, type MetaGridItem } from "@/components/shared/meta-grid";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { getConnectorIcon } from "@/lib/connectors/connector-icons";
import { useSkeleton } from "@/hooks/use-skeleton";

export function ConnectionDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: connection, isLoading } = useQuery({
    queryKey: queryKeys.connections.detail(id),
    queryFn: () => api.connections.get(id),
  });

  const { showSkeleton } = useSkeleton(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <>
        <PageShell.Header
          title="Connection"
          actions={
            <Button variant="ghost" size="icon" onClick={() => router.push("/connections")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          }
        />
        <PageShell.Content>
          <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {["Type", "Config"].map((label) => (
              <div key={label} className="min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <Skeleton loading className="block">
                  <p className="text-sm">placeholder-value</p>
                </Skeleton>
              </div>
            ))}
          </div>
        </PageShell.Content>
      </>
    ) : null;
  }

  if (!connection) {
    return <p className="text-muted-foreground p-4">Connection not found.</p>;
  }

  const config = (connection.config ?? {}) as Record<string, unknown>;
  const Icon = getConnectorIcon(connection.connector_type);

  const items: MetaGridItem[] = [
    {
      label: "Type",
      value: connection.connector_type,
      badge: { icon: <Icon className="h-3.5 w-3.5" />, variant: "outline" },
    },
    ...Object.entries(config).map<MetaGridItem>(([key, value]) => ({
      label: key,
      // Backend redacts secrets to `true` to signal "set but masked".
      value: value === true ? "" : String(value ?? ""),
      mono: value !== true,
      secret: value === true,
    })),
  ];

  return (
    <>
      <PageShell.Header
        title={connection.name}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm">
              <Link href={`/connections/${id}/edit`}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Link>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => router.push("/connections")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <PageShell.Content>
        <MetaGrid items={items} />
      </PageShell.Content>
    </>
  );
}
