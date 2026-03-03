"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SettingsSection, SettingsPage } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
      <ActionItem
        variant="destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(account.id);
        }}
      >
        Delete
      </ActionItem>
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
      toast.success("Cloud account deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
    },
    onError: () => toast.error("Failed to delete cloud account"),
  });

  const handleDelete = useCallback(
    (id: string) => { deleteMutation.mutate(id); },
    [deleteMutation],
  );

  const columns = useMemo(
    () => cloudAccountColumns(handleDelete, schema),
    [handleDelete, schema],
  );

  if (isLoading) {
    return showSkeleton ? (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    ) : null;
  }

  return (
    <SettingsPage>
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
          <DataTable
            columns={columns}
            data={accounts}
            searchKey="name"
            searchPlaceholder="Search accounts..."
            onRowClick={(account) =>
              router.push(`/settings/cloud-accounts/${account.id}`)
            }
            toolbarActions={
              <Button size="sm" asChild>
                <Link href="/settings/cloud-accounts/new">
                  <Plus size={14} />
                  Add account
                </Link>
              </Button>
            }
          />
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
