"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/hooks/use-async";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
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
  fetchSchema,
  fetchCloudAccounts,
  fetchConnections,
  deleteConnection,
} from "@/lib/api";
import { DeleteButton } from "@/components/delete-button";
import { getProviderIcon } from "@/lib/provider-icons";

export default function ConnectionsPage() {
  const router = useRouter();

  const { data, loading, reload } = useAsync(
    () => Promise.all([fetchConnections(), fetchSchema(), fetchCloudAccounts()]),
    [],
  );
  const [connections, schema, accounts] = data ?? [[], [], []];

  function findAccountProvider(cloudAccountId: string) {
    const account = accounts.find((a) => a.id === cloudAccountId);
    if (!account) return null;
    return schema.find((s) => s.id === account.provider_id) ?? null;
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title="Connections"
          subtitle="Manage connections to vocabulary hubs and data repositories."
        />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Connections"
        subtitle="Manage connections to vocabulary hubs and data repositories."
        action={
          <Button size="sm" className="gap-1.5" asChild>
            <Link href="/connections/new">
              <Plus size={14} />
              New Connection
            </Link>
          </Button>
        }
      />

      {connections.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No connections yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Cloud Account</TableHead>
              <TableHead>Container URL</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((conn) => {
              const account = accounts.find((a) => a.id === conn.cloud_account_id);
              const provider = findAccountProvider(conn.cloud_account_id);
              const Icon = provider ? getProviderIcon(provider.icon) : null;
              return (
                <TableRow
                  key={conn.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/connections/${conn.id}`)}
                >
                  <TableCell className="font-medium">{conn.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {Icon && <Icon className="h-4 w-4 shrink-0" />}
                      <span>{account?.name ?? conn.cloud_account_id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono">
                    {conn.container_url}
                  </TableCell>
                  <TableCell>
                    <DeleteButton
                      iconOnly
                      title="Delete connection"
                      description={`This will permanently delete "${conn.name}". This action cannot be undone.`}
                      onConfirm={async () => {
                        await deleteConnection(conn.id);
                        toast.success("Connection deleted");
                        reload();
                      }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
