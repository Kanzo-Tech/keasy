"use client";

import { useMemo } from "react";
import { KeyRound, Plus } from "lucide-react";
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
  Skeleton,
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
  selectColumn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import { type Credential, kindTitle } from "@/lib/connections";
import { getProviderIcon } from "@/lib/ui/provider-icons";
import { toastError } from "@/lib/errors";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

export default function CredentialsPage() {
  const router = useRouter();

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <Boundary
          fallback={
            <Loading>
              <Skeleton className="h-40 w-full" />
            </Loading>
          }
        >
          <Credentials />
        </Boundary>
      </SectionBody>
    </SectionRoot>
  );
}

function Credentials() {
  const router = useRouter();
  const credentials = settled($api.useSuspenseQuery("get", "/v1/credentials"));

  const refresh = () => invalidate("/v1/credentials", "/v1/connections");
  const remove = $api.useMutation("delete", "/v1/credentials/{name}", {
    onSuccess: () => {
      toast.create({ title: "Credential deleted", type: "success" });
      return refresh();
    },
    onError: (err) => toastError(err, "Failed to delete credential"),
  });
  const validate = $api.useMutation("post", "/v1/credentials/{name}/validate", {
    onSuccess: (report) => {
      const failed = report.results.some((c) => c.result === "fail");
      toast.create({ title: failed ? "Validation failed" : "Validation passed", type: failed ? "error" : "success" });
      return refresh();
    },
    onError: (err) => toastError(err, "Failed to validate"),
  });

  const columns = useMemo<ColumnDef<Credential>[]>(
    () => [
      selectColumn<Credential>(),
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
      actionsColumn<Credential>({
        label: (row) => `Actions for ${row.original.name}`,
        menu: (row) => {
          const path = { params: { path: { name: row.original.name } } };
          return (
            <>
              <MenuItem onSelect={() => validate.mutate({ ...path, body: {} })} value="validate">
                Test
              </MenuItem>
              <MenuItem onSelect={() => remove.mutate(path)} value="delete" variant="destructive">
                Delete
              </MenuItem>
            </>
          );
        },
      }),
    ],
    [remove, validate],
  );
  const table = useDataTable({ columns, data: credentials });
  const newHref = "/settings/credentials/new";

  return credentials.length === 0 ? (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyIndicator variant="icon">
          <KeyRound />
        </EmptyIndicator>
        <EmptyTitle asChild>
          <h2>No credentials</h2>
        </EmptyTitle>
        <EmptyDescription>
          A credential is who keasy is when it reaches a store; connections use it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild size="sm" variant="outline">
          <Link href={newHref}>Add credential</Link>
        </Button>
      </EmptyContent>
    </EmptyRoot>
  ) : (
    <DataTableRoot table={table}>
      <DataTableToolbar>
        <DataTableSearch column="name" placeholder="Search credentials..." />
        <div className="ms-auto flex items-center gap-2">
          <Button asChild size="sm">
            <Link href={newHref}>
              <Plus />
              Add credential
            </Link>
          </Button>
        </div>
      </DataTableToolbar>
      <DataTableContent<Credential>
        empty="No credentials match this filter."
        onRowClick={(c) => router.push(`/settings/credentials/${encodeURIComponent(c.name)}`)}
      />
      <DataTablePagination />
    </DataTableRoot>
  );
}
