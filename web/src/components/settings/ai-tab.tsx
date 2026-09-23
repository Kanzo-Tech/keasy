"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { toast } from "@kanzo-tech/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { Badge, Button, MenuItem } from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  DataTableSearch,
  DataTableToolbar,
  DataTableViewOptions,
  selectColumn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { actionsColumn } from "@/components/shared/actions-column";
import { EmptyState } from "@/components/shared/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { SettingsSectionSkeleton } from "@/components/settings/settings-section-skeleton";
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
      <MenuItem
        onSelect={() => onDelete(provider.provider)}
        value="delete"
        variant="destructive"
      >
        Delete
      </MenuItem>
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
      toast.create({ title: "AI provider deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
    },
    onError: () => toast.create({ title: "Failed to delete AI provider", type: "error" }),
  });

  const handleDelete = useCallback(
    (providerId: string) => { deleteMutation.mutate(providerId); },
    [deleteMutation],
  );

  const columns = useMemo(() => aiColumns(handleDelete), [handleDelete]);

  const table = useDataTable({ columns, data: providers });

  if (isLoading) {
    return showSkeleton ? (
      <SettingsSectionSkeleton
        description="Configure AI provider credentials for intelligent features."
      />
    ) : null;
  }

  return (
    <PageShell>
      <PageShell.Content className="gap-8">
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
            <DataTableRoot table={table}>
              <DataTableToolbar>
                <DataTableSearch column="provider" placeholder="Search providers..." />
                <div className="ms-auto flex items-center gap-2">
                  <DataTableViewOptions />
                  <Button size="sm" asChild>
                    <Link href="/settings/ai/new">
                      <Plus size={14} />
                      Add provider
                    </Link>
                  </Button>
                </div>
              </DataTableToolbar>
              <DataTableContent<AiSettings>
                empty="No providers match this filter."
                onRowClick={(provider) =>
                  router.push(`/settings/ai/${provider.provider}`)
                }
              />
              <DataTablePagination />
            </DataTableRoot>
          )}
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
