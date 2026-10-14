"use client";

import { useMemo } from "react";
import { KeyRound } from "lucide-react";
import { Badge, SectionBody, SectionRoot, toast } from "@kanzo-tech/ui";
import { actionsColumn, type ColumnDef, sortableHeader } from "@kanzo-tech/ui/table";
import { BlockedMenuItem } from "@/components/blocked";
import { CreatedBy } from "@/components/provenance";
import { ResourceList } from "@/components/resource-list";
import { ValidationBadge } from "@/components/validation-badge";
import { $api } from "@/lib/api/client";
import { type Credential, kindTitle } from "@/lib/connections";
import { getProviderIcon } from "@/lib/ui/provider-icons";
import { blocked } from "@/lib/permissions";

const CHANGES = ["/v1/secrets", "/v1/connections"] as const;

export default function CredentialsPage() {
  const remove = $api.useMutation("delete", "/v1/secrets/{name}", {
    meta: { success: "Credential deleted", failure: "Failed to delete credential", invalidates: CHANGES },
  });
  const validate = $api.useMutation("post", "/v1/secrets/{name}/validate", {
    meta: { failure: "Failed to validate", invalidates: CHANGES },
    onSuccess: (report) => {
      const failed = report.results.some((c) => c.result === "fail");
      toast.create({ title: failed ? "Validation failed" : "Validation passed", type: failed ? "error" : "success" });
    },
  });

  const columns = useMemo<ColumnDef<Credential>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader("Name"),
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        id: "kind",
        header: "Kind",
        cell: ({ row }) => {
          const { kind } = row.original.spec;
          const Icon = getProviderIcon(kind);
          return (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4" />
              {kindTitle(kind)}
            </span>
          );
        },
      },
      {
        id: "used_by",
        header: "Used by",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.used_by.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </div>
        ),
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
      actionsColumn<Credential>({
        label: (row) => `Actions for ${row.original.name}`,
        // Only editors reach this page. Any of them tests a credential; Delete is shown disabled,
        // with who may, on one they do not manage.
        menu: (row) => {
          const path = { params: { path: { name: row.original.name } } };
          return (
            <>
              <BlockedMenuItem
                onSelect={() => validate.mutate(path)}
                reason={blocked(row.original, "operate", "credential")}
                value="validate"
              >
                Test
              </BlockedMenuItem>
              <BlockedMenuItem
                onSelect={() => remove.mutate(path)}
                reason={blocked(row.original, "manage", "credential")}
                value="delete"
                variant="destructive"
              >
                Delete
              </BlockedMenuItem>
            </>
          );
        },
      }),
    ],
    [remove, validate],
  );

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <ResourceList
          columns={columns}
          create={{ label: "Add credential", href: "/settings/credentials/new" }}
          empty={{
            icon: <KeyRound />,
            title: "No credentials",
            description: "A credential is who keasy is when it reaches a store; connections use it.",
          }}
          href={(c) => `/settings/credentials/${encodeURIComponent(c.name)}`}
          noun="credentials"
          query={$api.queryOptions("get", "/v1/secrets")}
        />
      </SectionBody>
    </SectionRoot>
  );
}
