"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiSettings } from "@/lib/types";

function aiColumns(
  onDelete: (providerId: string) => void,
): ColumnDef<AiSettings>[] {
  return [
    selectColumn<AiSettings>(),
    {
      accessorKey: "provider",
      header: sortableHeader("Provider"),
      cell: ({ getValue }) => {
        const id = getValue<string>();
        const provider = AI_PROVIDERS.find((p) => p.id === id);
        if (!provider) return <span className="font-medium">{id}</span>;
        const Icon = provider.icon;
        return (
          <span className="inline-flex items-center gap-2 font-medium">
            <Icon className="h-4 w-4" />
            {provider.label}
          </span>
        );
      },
    },
    {
      id: "model",
      header: "Model",
      cell: ({ row }) => {
        const provider = AI_PROVIDERS.find((p) => p.id === row.original.provider);
        const model = row.original.model;
        if (model) return <span className="text-muted-foreground">{model}</span>;
        return (
          <span className="text-muted-foreground">
            Default: {provider?.defaultModel ?? "—"}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.api_key ? (
          <Badge variant="secondary">Connected</Badge>
        ) : null,
    },
    actionsColumn<AiSettings>((provider) => (
      <ActionItem
        variant="destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(provider.provider);
        }}
      >
        Delete
      </ActionItem>
    )),
  ];
}

export function AiTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: providers = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const deleteMutation = useMutation({
    mutationFn: (providerId: string) => api.ai.removeProvider(providerId),
    onSuccess: () => {
      toast.success("AI provider deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
    },
    onError: () => toast.error("Failed to delete AI provider"),
  });

  const handleDelete = useCallback(
    (providerId: string) => { deleteMutation.mutate(providerId); },
    [deleteMutation],
  );

  const columns = useMemo(() => aiColumns(handleDelete), [handleDelete]);

  if (isLoading) {
    return showSkeleton ? (
      <PageShell>
        <PageShell.Content className="space-y-4 max-w-2xl">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </PageShell.Content>
      </PageShell>
    ) : null;
  }

  return (
    <PageShell>
      <PageShell.Content className="space-y-8">
        <SettingsSection
          title="AI Providers"
          description="Configure AI provider credentials for intelligent features."
        >
          {providers.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No AI providers"
              description={
                <>
                  <Link href="/settings/ai/new" className="underline underline-offset-4 hover:text-foreground">
                    Add a provider
                  </Link>{" "}
                  to enable AI-powered features.
                </>
              }
            />
          ) : (
            <DataTable
              columns={columns}
              data={providers}
              searchKey="provider"
              searchPlaceholder="Search providers..."
              onRowClick={(provider) =>
                router.push(`/settings/ai/${provider.provider}`)
              }
              toolbarActions={
                <Button size="sm" asChild>
                  <Link href="/settings/ai/new">
                    <Plus size={14} />
                    Add provider
                  </Link>
                </Button>
              }
            />
          )}
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
