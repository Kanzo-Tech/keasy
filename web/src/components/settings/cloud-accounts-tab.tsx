"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/hooks/use-async";
import { fetchSchema, fetchCloudAccounts, deleteCloudAccount } from "@/lib/api";
import { getProviderIcon } from "@/lib/provider-icons";
import { DeleteButton } from "@/components/delete-button";
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
  const { data, loading, reload } = useAsync(
    () => Promise.all([fetchSchema(), fetchCloudAccounts()]),
    [],
  );

  const [schema, accounts] = data ?? [[], []];

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Auth Method</TableHead>
          <TableHead className="w-10">
            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
              <Link href="/settings/cloud-accounts/new">
                <Plus size={14} />
              </Link>
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
              No cloud accounts configured yet.
            </TableCell>
          </TableRow>
        ) : accounts.map((account) => {
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
                {authLabel ?? "—"}
              </TableCell>
              <TableCell>
                <DeleteButton
                  iconOnly
                  title="Delete cloud account"
                  description={`This will permanently delete "${account.name}". Connections using this account will stop working.`}
                  onConfirm={async () => {
                    await deleteCloudAccount(account.id);
                    toast.success("Cloud account deleted");
                    reload();
                  }}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
