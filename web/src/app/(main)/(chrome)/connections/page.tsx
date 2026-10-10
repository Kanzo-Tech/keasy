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
  SectionBody,
  SectionRoot,
  Skeleton,
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
import { useSession } from "@kanzo-tech/auth";
import { BlockedMenuItem } from "@/components/blocked";
import { CreatedBy } from "@/components/provenance";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import type { Connection } from "@/lib/connections";
import { toastError } from "@/lib/errors";
import { blocked } from "@/lib/permissions";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { PAGE_TABLE_HEIGHT } from "@/lib/ui/table-heights";

/** A tab: a storage connection's kind. */
type Tab = "data" | "vocab";

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: Tab }>;
}) {
  const router = useRouter();
  const { type: tab = "data" } = use(searchParams);

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
          <Boundary
            fallback={
              <Loading>
                <Skeleton className="h-40 w-full" />
              </Loading>
            }
          >
            <Connections tab={tab} />
          </Boundary>
        </Tabs>
      </SectionBody>
    </SectionRoot>
  );
}

function Connections({ tab }: { tab: Tab }) {
  const router = useRouter();
  const noun = { data: "data", vocab: "vocabulary" }[tab];
  const editor = useSession().can("editor");
  const all = settled($api.useSuspenseQuery("get", "/v1/connections"));
  // The sink is the admin's, on Workspace storage.
  const connections = useMemo(
    () =>
      all.filter((c) => c.target.kind === tab && c.target.direction === "source"),
    [all, tab],
  );

  const refresh = () => invalidate("/v1/connections", "/v1/secrets");
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
        accessorKey: "secret",
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
      {
        id: "created_by",
        header: "Created by",
        cell: ({ row }) => <CreatedBy of={row.original} />,
      },
      actionsColumn<Connection>({
        label: (row) => `Actions for ${row.original.name}`,
        // A reader is offered nothing here. An editor tests any connection — testing operates it,
        // as on a seeded one — and is shown Delete disabled, with who may, on one they do not manage.
        menu: (row) =>
          editor ? (
            <>
              <BlockedMenuItem
                onSelect={() => validate({ params: { path: { name: row.original.name } } })}
                reason={blocked(row.original, "operate", "connection")}
                value="validate"
              >
                Test
              </BlockedMenuItem>
              <BlockedMenuItem
                onSelect={() => remove({ params: { path: { name: row.original.name } } })}
                reason={blocked(row.original, "manage", "connection")}
                value="delete"
                variant="destructive"
              >
                Delete
              </BlockedMenuItem>
            </>
          ) : null,
      }),
    ],
    [editor, remove, validate],
  );
  const table = useDataTable({ columns, data: connections });

  return connections.length === 0 ? (
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
      {editor && (
        <EmptyContent>
          <Button asChild size="sm" variant="outline">
            <Link href={`/connections/new?type=${tab}`}>Create connection</Link>
          </Button>
        </EmptyContent>
      )}
    </EmptyRoot>
  ) : (
    <DataTableRoot table={table}>
      <DataTableToolbar>
        <DataTableSearch column="name" placeholder="Search connections..." />
        <div className="ms-auto flex items-center gap-2">
          <DataTableViewOptions />
          {editor && (
            <Button asChild size="sm">
              <Link href={`/connections/new?type=${tab}`}>
                <Plus />
                Create connection
              </Link>
            </Button>
          )}
        </div>
      </DataTableToolbar>
      <DataTableContent<Connection>
        maxHeight={PAGE_TABLE_HEIGHT}
        stickyHeader
        empty="No connections match this filter."
        onRowClick={(conn) => router.push(`/connections/${encodeURIComponent(conn.name)}`)}
      />
      <DataTablePagination />
    </DataTableRoot>
  );
}
