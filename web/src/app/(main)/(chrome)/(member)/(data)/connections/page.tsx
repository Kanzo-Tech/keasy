"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Database, MoreHorizontal, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionBody,
  SectionRoot,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@kanzo-tech/ui";
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
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";
import type { Connection, ConnectionKind } from "@/lib/types";

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: ConnectionKind }>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { type: tab = "data" } = use(searchParams);
  const noun = tab === "data" ? "data" : "vocabulary";

  const { data: connections = [] } = useQuery({
    queryKey: queryKeys.connections.all(tab),
    queryFn: () => api.connections.list(tab),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: api.cloud.list,
  });

  const { mutate: remove } = useMutation({
    mutationFn: api.connections.remove,
    onSuccess: () => {
      toast.create({ title: "Connection deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.all(tab) });
    },
    onError: (err) => toastError(err, "Failed to delete connection"),
  });

  const columns = useMemo<ColumnDef<Connection>[]>(
    () => [
      selectColumn<Connection>(),
      {
        accessorKey: "name",
        header: sortableHeader("Name"),
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) =>
          row.original.location_type === "cloud" && row.original.cloud_account_id ? (
            <span className="text-muted-foreground">
              {accounts.find((a) => a.id === row.original.cloud_account_id)?.name ??
                row.original.cloud_account_id}
            </span>
          ) : (
            <Badge variant="outline">Local</Badge>
          ),
      },
      {
        accessorKey: "url",
        header: "URL",
        cell: ({ getValue }) => (
          <span className="font-mono text-muted-foreground text-xs">{getValue<string>()}</span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        size: 48,
        cell: ({ row }) => (
          <div className="text-end">
            <Menu>
              <MenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${row.original.name}`}
                  onClick={(event) => event.stopPropagation()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => remove(row.original.id)} value="delete" variant="destructive">
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ),
      },
    ],
    [accounts, remove],
  );
  const table = useDataTable({ columns, data: connections });

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <Tabs onValueChange={(details) => router.push(`/connections?type=${details.value}`)} value={tab}>
          <TabsList>
            <TabsTrigger value="data">
              <Database />
              Data
            </TabsTrigger>
            <TabsTrigger value="vocab">
              <BookOpen />
              Vocabulary
            </TabsTrigger>
          </TabsList>

          {connections.length === 0 ? (
            <Item className="mx-auto max-w-md flex-col gap-2 py-10 text-center">
              <ItemMedia
                className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
                variant="icon"
              >
                {tab === "data" ? <Database /> : <BookOpen />}
              </ItemMedia>
              <ItemTitle className="text-base">No {noun} connections</ItemTitle>
              <ItemDescription>Create a {noun} connection to get started.</ItemDescription>
              <ItemActions>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/connections/new?type=${tab}`}>Create connection</Link>
                </Button>
              </ItemActions>
            </Item>
          ) : (
            <DataTableRoot table={table}>
              <DataTableToolbar>
                <DataTableSearch column="name" placeholder="Search connections..." />
                <div className="ms-auto flex items-center gap-2">
                  <DataTableViewOptions />
                  <Button asChild size="sm">
                    <Link href={`/connections/new?type=${tab}`}>
                      <Plus />
                      Create connection
                    </Link>
                  </Button>
                </div>
              </DataTableToolbar>
              <DataTableContent<Connection>
                empty="No connections match this filter."
                onRowClick={(conn) => router.push(`/connections/${conn.id}`)}
              />
              <DataTablePagination />
            </DataTableRoot>
          )}
        </Tabs>
      </SectionBody>
    </SectionRoot>
  );
}
