"use client";

import { useMemo } from "react";
import { Database } from "lucide-react";
import { Badge, SectionBody, SectionRoot, toast } from "@kanzo-tech/ui";
import { actionsColumn, type ColumnDef, sortableHeader } from "@kanzo-tech/ui/table";
import { useSession } from "@kanzo-tech/auth";
import { BlockedMenuItem } from "@/components/blocked";
import { CreatedBy } from "@/components/provenance";
import { ResourceList } from "@/components/resource-list";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, connectionsQuery } from "@/lib/api/client";
import type { Connection } from "@/lib/connections";
import { blocked } from "@/lib/permissions";

const CHANGES = ["/v1/connections", "/v1/secrets"] as const;

/**
 * The storage connections a program reads from. A connection is a location and nothing more: what a
 * file in it is — data or a vocabulary — its format says (docs/design/assistant.md, *A dataset's
 * vocabulary is a file beside it*).
 */
export default function ConnectionsPage() {
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
        <ResourceList
          columns={columns}
          create={editor ? { label: "Create connection", href: "/connections/new" } : undefined}
          empty={{
            icon: <Database />,
            title: "No connections",
            description: "Create a connection to get started.",
          }}
          href={(c) => `/connections/${encodeURIComponent(c.name)}`}
          noun="connections"
          query={{
            ...connectionsQuery,
            // The sink is the admin's, on Workspace storage.
            select: (all) => all.filter((c) => c.target.direction === "source"),
          }}
        />
      </SectionBody>
    </SectionRoot>
  );
}
