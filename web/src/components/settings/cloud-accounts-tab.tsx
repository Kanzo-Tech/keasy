"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, Plus } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { fetchSchema, fetchCloudAccounts, deleteCloudAccount } from "@/lib/api";
import { getProviderIcon } from "@/lib/provider-icons";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { SettingsSection, SettingsPage } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function CloudAccountsTab() {
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR(
    "cloud-init",
    () => Promise.all([fetchSchema(), fetchCloudAccounts()]),
  );
  const showSkeleton = useDelayedLoading(isLoading);

  const [schema, accounts] = data ?? [[], []];

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
            description="Add a cloud account to start creating sources."
          />
        ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Auth method</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const provider = schema.find((s) => s.id === account.provider_id);
                  const Icon = provider ? getProviderIcon(provider.icon) : null;
                  const authLabel = provider?.auth_methods.find(
                    (a) => a.name === account.auth_method
                  )?.label;

                  return (
                    <TableRow
                      key={account.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/settings/cloud-accounts/${account.id}`)}
                    >
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {Icon && <Icon className="h-4 w-4 shrink-0" />}
                          <span>{provider?.label ?? account.provider_id}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {authLabel ?? "\u2014"}
                      </TableCell>
                      <TableCell>
                        <DeleteButton
                          iconOnly
                          title="Delete cloud account"
                          description={`This will permanently delete "${account.name}". Sources using this account will stop working.`}
                          onConfirm={async () => {
                            await deleteCloudAccount(account.id);
                            toast.success("Cloud account deleted");
                            mutate();
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
