"use client";

import { use, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { formatFor } from "@fossil-lang/wasm";
import {
  Button,
  DataList,
  FormatByte,
  DataListItem,
  DataListItemLabel,
  DataListItemValue,
  MenuItem,
  SectionBody,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import {
  actionsColumn,
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Provenance } from "@/components/provenance";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import { formatsQuery } from "@/lib/fossil/checker";
import { toastError } from "@/lib/errors";
import { reference } from "@/lib/connections";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { PAGE_TABLE_HEIGHT } from "@/lib/ui/table-heights";

export default function ConnectionPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent(use(params).name);
  return (
    <Boundary
      fallback={
        <Loading>
          <SectionRoot>
            <SectionBody scale="page">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-40 w-full" />
            </SectionBody>
          </SectionRoot>
        </Loading>
      }
    >
      <ConnectionView name={name} />
    </Boundary>
  );
}

function ConnectionView({ name }: { name: string }) {
  const path = { params: { path: { name } } };
  const connection = settled($api.useSuspenseQuery("get", "/v1/connections/{name}", path));
  const storage = connection.target;
  const validate = $api.useMutation("post", "/v1/connections/{name}/validate", {
    onSuccess: () => invalidate("/v1/connections"),
    onError: (err) => toastError(err, "Failed to validate"),
  });

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <DataList className="grid gap-x-12 sm:grid-cols-4" orientation="vertical">
          <DataListItem>
            <DataListItemLabel>Credential</DataListItemLabel>
            <DataListItemValue className="font-medium">{connection.secret}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>URL</DataListItemLabel>
            <DataListItemValue className="break-all font-mono">
              {storage.url}
            </DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Kind</DataListItemLabel>
            <DataListItemValue>{storage.kind}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Status</DataListItemLabel>
            <DataListItemValue className="flex items-center gap-2">
              <ValidationBadge report={connection.validation} />
              {connection.can_modify && (
                <Button isLoading={validate.isPending} onClick={() => validate.mutate(path)} size="sm" variant="outline">
                  Test
                </Button>
              )}
            </DataListItemValue>
          </DataListItem>
        </DataList>
        <Provenance className="mt-4" of={connection} />

        {(
          <SectionRoot className="gap-2" fill={false}>
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>Files</SectionTitle>
              </SectionTitleGroup>
            </SectionHeader>
            <SectionBody>
              <Boundary
                fallback={
                  <Loading>
                    <Skeleton className="h-40 w-full" />
                  </Loading>
                }
              >
                <Files kind={storage.kind === "data" ? "data" : "schema"} name={name} url={storage.url} />
              </Boundary>
            </SectionBody>
          </SectionRoot>
        )}
      </SectionBody>
    </SectionRoot>
  );
}

type ConnectionFile = { path: string; size: number };

/** What a storage connection's prefix holds that a format reads. Fails on its own, beside the connection. */
function Files({ name, url, kind }: { name: string; url: string; kind: "data" | "schema" }) {
  const { files: listed, truncated } = settled(
    $api.useSuspenseQuery("get", "/v1/connections/{name}/files", { params: { path: { name } } }),
  );
  const formats = settled(useSuspenseQuery(formatsQuery));
  const readable = listed.filter((f) => formatFor(f.path, kind, formats));
  const cut = truncated && (
    <p className="text-muted-foreground text-xs">Only the first {listed.length.toLocaleString()} files are listed.</p>
  );

  function copyReference(path: string) {
    navigator.clipboard.writeText(reference({ name, url }, path));
    toast.create({ title: "Reference copied", type: "success" });
  }
  const columns = useMemo<ColumnDef<ConnectionFile>[]>(
    () => [
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.path}</span>,
      },
      {
        accessorKey: "size",
        header: () => <span className="block text-end">Size</span>,
        cell: ({ row }) => (
          <span className="block text-end text-muted-foreground text-xs">
            <FormatByte unitSystem="binary" value={row.original.size} />
          </span>
        ),
        size: 96,
      },
      actionsColumn<ConnectionFile>({
        label: (row) => `Actions for ${row.original.path}`,
        menu: (row) => (
          <MenuItem onSelect={() => copyReference(row.original.path)} value="copy-reference">
            Copy reference
          </MenuItem>
        ),
      }),
    ],
    // copyReference reads only `name` and `url`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, url],
  );
  const table = useDataTable({ columns, data: readable, getRowId: (file) => file.path });

  if (readable.length === 0) {
    return (
      <>
        <p className="text-muted-foreground text-xs">
          {listed.length === 0 ? "No files found." : "No supported files found."}
        </p>
        {cut}
      </>
    );
  }
  return (
    <>
      <DataTableRoot table={table}>
        <DataTableContent<ConnectionFile> maxHeight={PAGE_TABLE_HEIGHT} stickyHeader />
        <DataTablePagination />
      </DataTableRoot>
      {cut}
    </>
  );
}
