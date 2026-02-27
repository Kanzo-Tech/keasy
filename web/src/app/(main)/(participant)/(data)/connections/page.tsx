"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import useSWR from "swr";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  fetchConnections,
  fetchSchema,
  fetchCloudAccounts,
  deleteConnection,
} from "@/lib/api";
import { getConnectionColumns } from "@/components/columns/connection-columns";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
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

  const { data, mutate } = useSWR(`connections-init-${tab}`, () =>
    Promise.all([fetchConnections(tab), fetchSchema(), fetchCloudAccounts()]),
  );
  const [connections, schema, accounts] = data ?? [[], [], []];

  function handleTabChange(value: string) {
    router.push(`/connections?type=${value}`);
  }

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteConnection(id);
      toast.success("Connection deleted");
      mutate();
    },
    [mutate],
  );

  const columns = useMemo(
    () => getConnectionColumns({ onDelete: handleDelete, accounts, schema }),
    [handleDelete, accounts, schema],
  );

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <div className="flex items-center justify-between">
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
        <Button asChild size="sm">
          <Link href="/connections/new">
            <Plus size={14} className="mr-1" />
            Create connection
          </Link>
        </Button>
      </div>

        {connections.length === 0 ? (
          <EmptyState
            icon={tab === "data" ? Database : BookOpen}
            title={`No ${tab === "data" ? "data" : "vocabulary"} connections`}
            description={`Create a ${tab === "data" ? "data" : "vocabulary"} connection to get started.`}
            actionHref="/connections/new"
            actionLabel="Create connection"
          />
        ) : (
          <DataTable
            columns={columns}
            data={connections}
            searchKey="name"
            searchPlaceholder="Search connections..."
            onRowClick={(conn) => router.push(`/connections/${conn.id}`)}
          />
        )}
    </Tabs>
  );
}
