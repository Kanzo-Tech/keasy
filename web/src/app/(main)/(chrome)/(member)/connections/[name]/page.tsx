"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { AlertCircle, MoreHorizontal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DataList,
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
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { $api, invalidate } from "@/lib/api/client";
import { modelOf, storageOf } from "@/lib/connections";
import { providersQuery } from "@/lib/fossil/checker";
import { formatSize } from "@/lib/formatters";
import { toastError } from "@/lib/toast-error";
import { readableFiles } from "@/lib/utils";

export default function ConnectionPage({ params }: { params: Promise<{ name: string }> }) {
  const path = { params: { path: { name: decodeURIComponent(use(params).name) } } };

  const { data: connection, isLoading: connLoading } = $api.useQuery("get", "/v1/connections/{name}", path);
  const { data: providers = [], isLoading: providersLoading } = useQuery(providersQuery);
  const storage = connection && storageOf(connection);
  const files = $api.useQuery("get", "/v1/connections/{name}/files", path, { enabled: !!storage });
  const validate = $api.useMutation("post", "/v1/connections/{name}/validate", {
    onSuccess: () => invalidate("/v1/connections"),
    onError: (err) => toastError(err, "Failed to validate"),
  });

  const isLoading = connLoading || providersLoading;
  const showSkeleton = useDelayedLoading(isLoading || files.isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <SectionRoot>
        <SectionBody scale="page">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
        </SectionBody>
      </SectionRoot>
    ) : null;
  }
  if (!connection) notFound();

  const model = modelOf(connection);
  const listed = files.data ?? [];
  const readable = readableFiles(listed, providers, storage?.kind === "data" ? "data" : "schema");

  const { name } = connection;
  function copyReference(path: string) {
    navigator.clipboard.writeText(`@${name}/${path}`);
    toast.create({ title: "Reference copied", type: "success" });
  }

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <DataList className="grid gap-x-12 sm:grid-cols-4" orientation="vertical">
          <DataListItem>
            <DataListItemLabel>Credential</DataListItemLabel>
            <DataListItemValue className="font-medium">{connection.credential}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>{storage ? "URL" : "Model"}</DataListItemLabel>
            <DataListItemValue className="break-all font-mono">
              {storage?.url ?? model?.model ?? "provider default"}
            </DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>{storage ? "Kind" : "Max tokens"}</DataListItemLabel>
            <DataListItemValue>{storage ? storage.kind : (model?.max_tokens ?? "—")}</DataListItemValue>
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

        {storage && (
          <section className="space-y-2">
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>Files</SectionTitle>
              </SectionTitleGroup>
            </SectionHeader>
            {files.isError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Failed to list files</AlertTitle>
                <AlertDescription>{files.error.message}</AlertDescription>
              </Alert>
            ) : files.isLoading ? (
              showSkeleton && <Skeleton className="h-40 w-full" />
            ) : readable.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {listed.length === 0 ? "No files found." : "No supported files found."}
              </p>
            ) : (
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
                        {formatSize(f.size)}
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
            )}
          </section>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
