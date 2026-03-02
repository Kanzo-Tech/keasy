"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import useSWR from "swr";
import type { ColumnDef } from "@tanstack/react-table";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  DataTable,
  ActionItem,
  selectColumn,
  sortableHeader,
  actionsColumn,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import type { Connection, CloudAccountSummary, ProviderSchema, ConnectionKind } from "@/lib/types";

function connectionColumns(
  onDelete: (id: string) => void,
  accounts: CloudAccountSummary[],
  _schema: ProviderSchema[],
): ColumnDef<Connection>[] {
  return [
    selectColumn<Connection>(),
    {
      accessorKey: "name",
      header: sortableHeader("Name"),
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue<string>()}</span>
      ),
    },
    {
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const conn = row.original;
        if (conn.location_type === "cloud" && conn.cloud_account_id) {
          const account = accounts.find((a) => a.id === conn.cloud_account_id);
          return (
            <span className="text-muted-foreground">
              {account?.name ?? conn.cloud_account_id}
            </span>
          );
        }
        return <Badge variant="outline">Local</Badge>;
      },
    },
    {
      accessorKey: "url",
      header: "URL",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground font-mono text-xs">{getValue<string>()}</span>
      ),
    },
    actionsColumn<Connection>((conn) => (
      <ActionItem
        variant="destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conn.id);
        }}
      >
        Delete
      </ActionItem>
    )),
  ];
}

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
    Promise.all([api.connections.list(tab), api.settings.schema(), api.cloud.list()]),
  );
  const [connections, schema, accounts] = data ?? [[], [], []];

  function handleTabChange(value: string) {
    router.push(`/connections?type=${value}`);
  }

  const handleDelete = useCallback(
    async (id: string) => {
      await api.connections.remove(id);
      toast.success("Connection deleted");
      mutate();
    },
    [mutate],
  );

  const columns = useMemo(
    () => connectionColumns(handleDelete, accounts, schema),
    [handleDelete, accounts, schema],
  );

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
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

        {connections.length === 0 ? (
          <EmptyState
            icon={tab === "data" ? Database : BookOpen}
            title={`No ${tab === "data" ? "data" : "vocabulary"} connections`}
            description={
              <>
                <Link href={`/connections/new?type=${tab}`} className="underline underline-offset-4 hover:text-foreground">
                  Create a {tab === "data" ? "data" : "vocabulary"} connection
                </Link>{" "}
                to get started.
              </>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={connections}
            searchKey="name"
            searchPlaceholder="Search connections..."
            onRowClick={(conn) => router.push(`/connections/${conn.id}`)}
            toolbarActions={
              <Button asChild size="sm">
                <Link href={`/connections/new?type=${tab}`}>
                  <Plus size={14} className="mr-1" />
                  Create connection
                </Link>
              </Button>
            }
          />
        )}
    </Tabs>
  );
}
