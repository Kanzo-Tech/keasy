"use client";

import { use, useMemo } from "react";
import { BookOpen, Database, Plus } from "lucide-react";
import {
  Badge,
  Button,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  MenuItem,
  SectionBody,
  SectionRoot,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@kanzo-tech/ui";
import {
  actionsColumn,
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
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import type { Connection } from "@/lib/connections";
import { toastError } from "@/lib/errors";

/** A tab: a storage connection's kind. */
type Tab = "data" | "vocab";

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: Tab }>;
}) {
  const router = useRouter();
  const { type: tab = "data" } = use(searchParams);
  const noun = { data: "data", vocab: "vocabulary" }[tab];

  const { data: all = [] } = $api.useQuery("get", "/v1/connections");
  // The sink is the owner's, on Catalog Storage.
  const connections = useMemo(
    () =>
      all.filter((c) => c.target.kind === tab && c.target.direction === "source"),
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
        header: "URL",
        cell: ({ row }) => <span className="font-mono text-muted-foreground text-xs">{row.original.target.url}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <ValidationBadge report={row.original.validation} />,
      },
      actionsColumn<Connection>({
        label: (row) => `Actions for ${row.original.name}`,
        menu: (row) => (
          <>
            <MenuItem onSelect={() => validate({ params: { path: { name: row.original.name } } })} value="validate">
              Test
            </MenuItem>
            <MenuItem
              onSelect={() => remove({ params: { path: { name: row.original.name } } })}
              value="delete"
              variant="destructive"
            >
              Delete
            </MenuItem>
          </>
        ),
      }),
    ],
    [remove, validate],
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
            <EmptyRoot>
              <EmptyHeader>
                <EmptyIndicator variant="icon">
                  {{ data: <Database />, vocab: <BookOpen /> }[tab]}
                </EmptyIndicator>
                <EmptyTitle asChild>
                  <h2>No {noun} connections</h2>
                </EmptyTitle>
                <EmptyDescription>Create a {noun} connection to get started.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/connections/new?type=${tab}`}>Create connection</Link>
                </Button>
              </EmptyContent>
            </EmptyRoot>
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
