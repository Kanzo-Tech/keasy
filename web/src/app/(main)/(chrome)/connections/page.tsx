"use client";

import { use, useMemo } from "react";
import { BookOpen, Database } from "lucide-react";
import { Badge, SectionBody, SectionRoot, Tabs, TabsList, TabsTrigger, toast } from "@kanzo-tech/ui";
import { actionsColumn, type ColumnDef, sortableHeader } from "@kanzo-tech/ui/table";
import { useRouter } from "@kanzo-tech/navigation/next";
import { useSession } from "@kanzo-tech/auth";
import { BlockedMenuItem } from "@/components/blocked";
import { CreatedBy } from "@/components/provenance";
import { ResourceList } from "@/components/resource-list";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, connectionsQuery } from "@/lib/api/client";
import type { Connection } from "@/lib/connections";
import { blocked } from "@/lib/permissions";

/** A tab: a storage connection's kind. */
type Tab = "data" | "vocab";

const CHANGES = ["/v1/connections", "/v1/secrets"] as const;

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: Tab }>;
}) {
  const router = useRouter();
  const { type: tab = "data" } = use(searchParams);
  const noun = { data: "data", vocab: "vocabulary" }[tab];
  const editor = useSession().can("editor");

  const { mutate: remove } = $api.useMutation("delete", "/v1/connections/{name}", {
    meta: { success: "Connection deleted", failure: "Failed to delete connection", invalidates: CHANGES },
  });
  const { mutate: validate } = $api.useMutation("post", "/v1/connections/{name}/validate", {
    meta: { failure: "Failed to validate", invalidates: CHANGES },
    onSuccess: (report) => {
      const failed = report.results.some((c) => c.result === "fail");
      toast.create({ title: failed ? "Validation failed" : "Validation passed", type: failed ? "error" : "success" });
    },
  });

  const columns = useMemo<ColumnDef<Connection>[]>(
    () => [
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
          <ResourceList
            columns={columns}
            create={editor ? { label: "Create connection", href: `/connections/new?type=${tab}` } : undefined}
            empty={{
              icon: { data: <Database />, vocab: <BookOpen /> }[tab],
              title: `No ${noun} connections`,
              description: `Create a ${noun} connection to get started.`,
            }}
            href={(c) => `/connections/${encodeURIComponent(c.name)}`}
            key={tab}
            noun="connections"
            query={{
              ...connectionsQuery,
              // The sink is the admin's, on Workspace storage.
              select: (all) => all.filter((c) => c.target.kind === tab && c.target.direction === "source"),
            }}
          />
        </Tabs>
      </SectionBody>
    </SectionRoot>
  );
}
