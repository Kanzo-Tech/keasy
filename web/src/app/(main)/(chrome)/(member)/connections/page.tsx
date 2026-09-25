"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Database, MoreHorizontal, Plus, Sparkles } from "lucide-react";
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
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import { type Connection, modelOf, storageOf } from "@/lib/connections";
import { toastError } from "@/lib/errors";

/** A tab: a storage connection's kind, or the model connections. */
type Tab = "data" | "vocab" | "model";

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: Tab }>;
}) {
  const router = useRouter();
  const { type: tab = "data" } = use(searchParams);
  const noun = { data: "data", vocab: "vocabulary", model: "model" }[tab];

  const { data: all = [] } = $api.useQuery("get", "/v1/connections");
  // The sink is the owner's, on Catalog Storage.
  const connections = useMemo(
    () =>
      all.filter((c) => {
        const storage = storageOf(c);
        return tab === "model" ? !!modelOf(c) : storage?.kind === tab && storage.direction === "source";
      }),
    [all, tab],
  );

  const refresh = () => invalidate("/v1/connections", "/v1/credentials");
  const { mutate: remove } = $api.useMutation("delete", "/v1/connections/{name}", {
    onSuccess: () => {
      toast.create({ title: "Connection deleted", type: "success" });
      return refresh();
    },
    onError: (err) => toastError(err, "Failed to delete connection"),
  });
  const { mutate: validate } = $api.useMutation("post", "/v1/connections/{name}/validate", {
    onSuccess: (report) => {
      const failed = report.results.some((c) => c.result === "fail");
      toast.create({ title: failed ? "Validation failed" : "Validation passed", type: failed ? "error" : "success" });
      return refresh();
    },
    onError: (err) => toastError(err, "Failed to validate"),
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
        accessorKey: "credential",
        header: "Credential",
        cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge>,
      },
      {
        id: "target",
        header: tab === "model" ? "Model" : "URL",
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground text-xs">
            {storageOf(row.original)?.url ?? modelOf(row.original)?.model ?? "provider default"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <ValidationBadge report={row.original.validation} />,
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
                <MenuItem
                  onSelect={() => validate({ params: { path: { name: row.original.name } } })}
                  value="validate"
                >
                  Test
                </MenuItem>
                <MenuItem
                  onSelect={() => remove({ params: { path: { name: row.original.name } } })}
                  value="delete"
                  variant="destructive"
                >
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ),
      },
    ],
    [remove, tab, validate],
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
            <TabsTrigger value="model">
              <Sparkles />
              Models
            </TabsTrigger>
          </TabsList>

          {connections.length === 0 ? (
            <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
              <ItemMedia
                className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
                variant="icon"
              >
                {{ data: <Database />, vocab: <BookOpen />, model: <Sparkles /> }[tab]}
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
                onRowClick={(conn) => router.push(`/connections/${encodeURIComponent(conn.name)}`)}
              />
              <DataTablePagination />
            </DataTableRoot>
          )}
        </Tabs>
      </SectionBody>
    </SectionRoot>
  );
}
