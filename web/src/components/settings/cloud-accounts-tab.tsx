"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, Plus } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { fetchSchema, fetchCloudAccounts, deleteCloudAccount } from "@/lib/api";
import { getCloudAccountColumns } from "@/components/columns/cloud-account-columns";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { SettingsSection, SettingsPage } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function CloudAccountsTab() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR(
    "cloud-init",
    () => Promise.all([fetchSchema(), fetchCloudAccounts()]),
  );
  const showSkeleton = useDelayedLoading(isLoading);

  const [schema, accounts] = data ?? [[], []];

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteCloudAccount(id);
      toast.success("Cloud account deleted");
      mutate();
    },
    [mutate],
  );

  const columns = useMemo(
    () => getCloudAccountColumns({ onDelete: handleDelete, schema }),
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
        action={
          <Button size="sm" asChild>
            <Link href="/settings/cloud-accounts/new">
              <Plus size={14} />
              Add account
            </Link>
          </Button>
        }
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
          />
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
