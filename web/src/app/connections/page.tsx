"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Database, BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  fetchConnections,
  fetchSchema,
  fetchCloudAccounts,
  deleteConnection,
} from "@/lib/api";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getProviderIcon } from "@/lib/provider-icons";
import type { ConnectionKind } from "@/lib/types";

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsContent />
    </Suspense>
  );
}

function ConnectionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = (searchParams.get("type") as ConnectionKind) || "data";

  const { data, isLoading, mutate } = useSWR(
    `connections-init-${tab}`,
    () => Promise.all([fetchConnections(tab), fetchSchema(), fetchCloudAccounts()]),
  );
  const showSkeleton = useDelayedLoading(isLoading);
  const [connections, schema, accounts] = data ?? [[], [], []];

  function findAccountProvider(cloudAccountId: string) {
    const account = accounts.find((a) => a.id === cloudAccountId);
    if (!account) return null;
    return schema.find((s) => s.id === account.provider_id) ?? null;
  }

  function handleTabChange(value: string) {
    router.push(`/connections?type=${value}`);
  }

  if (isLoading) {
    return showSkeleton ? (
      <ScrollArea className="flex-1 min-h-0">
        <PageHeader
          title="Connections"
          subtitle="Manage data connections and vocabulary hubs."
        />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </ScrollArea>
    ) : null;
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <PageHeader
        title="Connections"
        subtitle="Manage data connections and vocabulary hubs."
        action={
          <Button size="sm" className="gap-1.5" asChild>
            <Link href={`/connections/new?type=${tab}`}>
              <Plus size={14} />
              New Connection
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="mb-4">
        <TabsList>
          <TabsTrigger value="data" className="gap-1.5">
            <Database size={14} />
            Data
          </TabsTrigger>
          <TabsTrigger value="vocab" className="gap-1.5">
            <BookOpen size={14} />
            Vocabulary
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {connections.length === 0 ? (
        <EmptyState
          icon={tab === "data" ? Database : BookOpen}
          title={`No ${tab === "data" ? "data" : "vocabulary"} connections`}
          description={`Create a ${tab === "data" ? "data" : "vocabulary"} connection to get started.`}
        />
      ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => {
                const account = connection.cloud_account_id
                  ? accounts.find((a) => a.id === connection.cloud_account_id)
                  : null;
                const provider = connection.cloud_account_id
                  ? findAccountProvider(connection.cloud_account_id)
                  : null;
                const Icon = provider ? getProviderIcon(provider.icon) : null;
                return (
                  <TableRow
                    key={connection.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/connections/${connection.id}`)}
                  >
                    <TableCell className="font-medium">{connection.name}</TableCell>
                    <TableCell>
                      {connection.location_type === "cloud" ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {Icon && <Icon className="h-4 w-4 shrink-0" />}
                          <span>{account?.name ?? connection.cloud_account_id}</span>
                        </div>
                      ) : (
                        <Badge variant="outline">Local</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {connection.url}
                    </TableCell>
                    <TableCell>
                      <DeleteButton
                        iconOnly
                        title="Delete connection"
                        description={`This will permanently delete "${connection.name}". This action cannot be undone.`}
                        onConfirm={async () => {
                          await deleteConnection(connection.id);
                          toast.success("Connection deleted");
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
    </ScrollArea>
  );
}
