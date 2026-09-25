"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, MoreHorizontal, Plus, Sparkles } from "lucide-react";
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
  selectColumn,
  sortableHeader,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import { type Credential, kindTitle, type Purpose, specOf } from "@/lib/connections";
import { getProviderIcon } from "@/lib/provider-icons";
import { toastError } from "@/lib/toast-error";

export default function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: Purpose }>;
}) {
  const router = useRouter();
  const { purpose = "storage" } = use(searchParams);
  const { data: credentials = [] } = $api.useQuery("get", "/v1/credentials", {
    params: { query: { purpose } },
  });

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
          const { purpose, spec } = specOf(row.original);
          const kind = String(spec.kind);
          const Icon = getProviderIcon(kind);
          return (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4" />
              {kindTitle(purpose, kind)}
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
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        size: 48,
        cell: ({ row }) => {
          const path = { params: { path: { name: row.original.name } } };
          return (
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
                  <MenuItem onSelect={() => validate.mutate({ ...path, body: {} })} value="validate">
                    Test
                  </MenuItem>
                  <MenuItem onSelect={() => remove.mutate(path)} value="delete" variant="destructive">
                    Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          );
        },
      },
    ],
    [remove, validate],
  );
  const table = useDataTable({ columns, data: credentials });
  const noun = purpose === "storage" ? "storage" : "AI";
  const newHref = `/settings/credentials/new?purpose=${purpose}`;

  return (
    <SectionRoot>
      <SectionBody className="overflow-hidden" scale="page">
        <Tabs onValueChange={(details) => router.push(`/settings/credentials?purpose=${details.value}`)} value={purpose}>
          <TabsList>
            <TabsTrigger value="storage">
              <KeyRound />
              Storage
            </TabsTrigger>
            <TabsTrigger value="model">
              <Sparkles />
              AI
            </TabsTrigger>
          </TabsList>

          {credentials.length === 0 ? (
            <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
              <ItemMedia
                className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
                variant="icon"
              >
                {purpose === "storage" ? <KeyRound /> : <Sparkles />}
              </ItemMedia>
              <ItemTitle className="text-base">No {noun} credentials</ItemTitle>
              <ItemDescription>
                A credential is who keasy is when it reaches a store or a model; connections use it.
              </ItemDescription>
              <ItemActions>
                <Button asChild size="sm" variant="outline">
                  <Link href={newHref}>Add credential</Link>
                </Button>
              </ItemActions>
            </Item>
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
          )}
        </Tabs>
      </SectionBody>
    </SectionRoot>
  );
}
