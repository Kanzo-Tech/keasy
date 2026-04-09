"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Database, Plus } from "lucide-react";
import { getProviderIcon } from "@/lib/provider-icons";
import { toast } from "sonner";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { Connector } from "@/lib/types";

function connectorColumns(
  onDelete: (id: string) => void,
): ColumnDef<Connector>[] {
  return [
    selectColumn<Connector>(),
    {
      accessorKey: "name",
      header: sortableHeader("Name"),
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: "connector_type",
      header: "Type",
      cell: ({ getValue }) => {
        const type = getValue<string>();
        const Icon = getProviderIcon(type);
        return (
          <Badge variant="outline" className="gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {type}
          </Badge>
        );
      },
    },
    actionsColumn<Connector>((conn) => (
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
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: api.connections.remove,
    onSuccess: () => {
      toast.success("Connection deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all() });
    },
  });

  const handleDelete = useCallback(
    (id: string) => deleteMutation.mutate(id),
    [deleteMutation],
  );

  const columns = useMemo(
    () => connectorColumns(handleDelete),
    [handleDelete],
  );

  return (
    <PageShell>
    <PageShell.Content className="overflow-hidden">
        {connections.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No connections"
            description={
              <>
                <Link href="/connections/new" className="underline underline-offset-4 hover:text-foreground">
                  Create a connection
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
                <Link href="/connections/new">
                  <Plus size={14} className="mr-1" />
                  Create connection
                </Link>
              </Button>
            }
          />
        )}
    </PageShell.Content>
    </PageShell>
  );
}
