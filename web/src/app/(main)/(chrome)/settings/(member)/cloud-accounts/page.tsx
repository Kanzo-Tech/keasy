"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cloud, MoreHorizontal, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
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
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { CloudAccountSummary } from "@/lib/types";

export default function CloudAccountsPage() {
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

  const { mutate: remove } = useMutation({
    mutationFn: (id: string) => api.cloud.remove(id),
    onSuccess: () => {
      toast.create({ title: "Cloud account deleted", type: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
    },
    onError: () => toast.create({ title: "Failed to delete cloud account", type: "error" }),
  });

  const columns = useMemo<ColumnDef<CloudAccountSummary>[]>(
    () => [
      selectColumn<CloudAccountSummary>(),
      {
        accessorKey: "name",
        header: sortableHeader("Name"),
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        id: "provider",
        header: "Provider",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {schema.find((s) => s.id === row.original.provider_id)?.label ?? row.original.provider_id}
          </span>
        ),
      },
      {
        id: "auth_method",
        header: "Auth method",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {schema
              .find((s) => s.id === row.original.provider_id)
              ?.auth_methods.find((a) => a.name === row.original.auth_method)?.label ?? "—"}
          </span>
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
    [remove, schema],
  );
  const table = useDataTable({ columns, data: accounts });

  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Cloud accounts
          </SectionTitle>
          <SectionDescription>
            Manage credentials for cloud storage providers. Accounts are used by sources to access
            data.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        {isLoading ? (
          showSkeleton && <Skeleton className="h-40 w-full" />
        ) : accounts.length === 0 ? (
          <Item className="mx-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Cloud />
            </ItemMedia>
            <ItemTitle className="text-base">No cloud accounts</ItemTitle>
            <ItemDescription>Add a cloud account to start creating data connections.</ItemDescription>
            <ItemActions>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings/cloud-accounts/new">Add account</Link>
              </Button>
            </ItemActions>
          </Item>
        ) : (
          <DataTableRoot table={table}>
            <DataTableToolbar>
              <DataTableSearch column="name" placeholder="Search accounts..." />
              <div className="ms-auto flex items-center gap-2">
                <DataTableViewOptions />
                <Button asChild size="sm">
                  <Link href="/settings/cloud-accounts/new">
                    <Plus />
                    Add account
                  </Link>
                </Button>
              </div>
            </DataTableToolbar>
            <DataTableContent<CloudAccountSummary>
              empty="No accounts match this filter."
              onRowClick={(account) => router.push(`/settings/cloud-accounts/${account.id}`)}
            />
            <DataTablePagination />
          </DataTableRoot>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
