"use client";

import { use } from "react";
import { MoreHorizontal } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { providerFor } from "@fossil-lang/wasm";
import {
  Button,
  DataList,
  FormatByte,
  DataListItem,
  DataListItemLabel,
  DataListItemValue,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionBody,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@kanzo-tech/ui";
import { ValidationBadge } from "@/components/validation-badge";
import { $api, invalidate } from "@/lib/api/client";
import { providersQuery } from "@/lib/fossil/checker";
import { toastError } from "@/lib/errors";
import { reference } from "@/lib/connections";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

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
              <Button isLoading={validate.isPending} onClick={() => validate.mutate(path)} size="sm" variant="outline">
                Test
              </Button>
            </DataListItemValue>
          </DataListItem>
        </DataList>

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

/** What a storage connection's prefix holds that a provider can read. Fails on its own, beside the connection. */
function Files({ name, url, kind }: { name: string; url: string; kind: "data" | "schema" }) {
  const { files: listed, truncated } = settled(
    $api.useSuspenseQuery("get", "/v1/connections/{name}/files", { params: { path: { name } } }),
  );
  const providers = settled(useSuspenseQuery(providersQuery));
  const readable = listed.filter((f) => providerFor(f.path, kind, providers));
  const cut = truncated && (
    <p className="text-muted-foreground text-xs">Only the first {listed.length.toLocaleString()} files are listed.</p>
  );

  function copyReference(path: string) {
    navigator.clipboard.writeText(reference({ name, url }, path));
    toast.create({ title: "Reference copied", type: "success" });
  }

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Path</TableHead>
            <TableHead className="w-24 text-end">Size</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {readable.map((f) => (
            <TableRow key={f.path}>
              <TableCell className="font-mono text-xs">{f.path}</TableCell>
              <TableCell className="text-end text-muted-foreground text-xs">
                <FormatByte unitSystem="binary" value={f.size} />
              </TableCell>
              <TableCell>
                <Menu positioning={{ placement: "bottom-end" }}>
                  <MenuTrigger asChild>
                    <Button aria-label={`Actions for ${f.path}`} size="icon-sm" variant="ghost">
                      <MoreHorizontal />
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => copyReference(f.path)} value="copy-reference">
                      Copy reference
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cut}
    </>
  );
}
