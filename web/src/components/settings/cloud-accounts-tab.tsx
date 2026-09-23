"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, Plus } from "lucide-react";
import { toast } from "@kanzo-tech/ui";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Button, MenuItem } from "@kanzo-tech/ui";
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
import type { CloudAccountSummary, ProviderSchema } from "@/lib/types";

function cloudAccountColumns(
  onDelete: (id: string) => void,
  schema: ProviderSchema[],
): ColumnDef<CloudAccountSummary>[] {
  return [
    selectColumn<CloudAccountSummary>(),
    {
      accessorKey: "name",
      header: sortableHeader("Name"),
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: "provider",
      header: "Provider",
      cell: ({ row }) => {
        const provider = schema.find((s) => s.id === row.original.provider_id);
        return (
          <span className="text-muted-foreground">
            {provider?.label ?? row.original.provider_id}
          </span>
        );
      },
    },
    {
      id: "auth_method",
      header: "Auth method",
      cell: ({ row }) => {
        const provider = schema.find((s) => s.id === row.original.provider_id);
        const label = provider?.auth_methods.find(
          (a) => a.name === row.original.auth_method,
        )?.label;
        return <span className="text-muted-foreground">{label ?? "\u2014"}</span>;
      },
    },
    actionsColumn<CloudAccountSummary>((account) => (
      <MenuItem
        onSelect={() => onDelete(account.id)}
        value="delete"
        variant="destructive"
      >
        Delete
      </MenuItem>
    )),
  ];
}

export function CloudAccountsTab() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: schema = [], isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.settings.schema,
    queryFn: api.settings.schema,
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: api.cloud.list,
  });
  const isLoading = schemaLoading || accountsLoading;
  const showSkeleton = useDelayedLoading(isLoading);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.cloud.remove(id),
    onSuccess: () => {
      toast.create({ title: "Cloud account deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
    },
    onError: () => toast.create({ title: "Failed to delete cloud account", type: "error" }),
  });

  const handleDelete = useCallback(
    (id: string) => { deleteMutation.mutate(id); },
    [deleteMutation],
  );

  const columns = useMemo(
    () => cloudAccountColumns(handleDelete, schema),
    [handleDelete, schema],
  );

  const table = useDataTable({ columns, data: accounts });

  if (isLoading) {
    return showSkeleton ? (
      <SettingsSectionSkeleton
        description="Manage credentials for cloud storage providers."
      />
    ) : null;
  }

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Cloud accounts"
        description="Manage credentials for cloud storage providers. Accounts are used by sources to access data."
      >
        {accounts.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="No cloud accounts"
            description={
              <>
                <Link href="/settings/cloud-accounts/new" className="underline underline-offset-4 hover:text-foreground">
                  Add a cloud account
                </Link>{" "}
                to start creating data connections.
              </>
            }
          />
        ) : (
          <DataTableRoot table={table}>
            <DataTableToolbar>
              <DataTableSearch column="name" placeholder="Search accounts..." />
              <div className="ms-auto flex items-center gap-2">
                <DataTableViewOptions />
                <Button size="sm" asChild>
                  <Link href="/settings/cloud-accounts/new">
                    <Plus size={14} />
                    Add account
                  </Link>
                </Button>
              </div>
            </DataTableToolbar>
            <DataTableContent<CloudAccountSummary>
              empty="No accounts match this filter."
              onRowClick={(account) =>
                router.push(`/settings/cloud-accounts/${account.id}`)
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
