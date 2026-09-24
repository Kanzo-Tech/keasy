"use client";

import { createElement, use } from "react";
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
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { providers as fossilProviders } from "@/lib/fossil/checker";
import { formatSize } from "@/lib/formatters";
import { getProviderIcon } from "@/lib/provider-icons";
import { queryKeys } from "@/lib/query-keys";

export default function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: queryKeys.connections.detail(id),
    queryFn: () => api.connections.get(id),
  });
  const { data: schema = [], isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.settings.schema,
    queryFn: api.settings.schema,
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: api.cloud.list,
  });
  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: queryKeys.settings.providers,
    queryFn: () => fossilProviders(),
  });
  const cloud = connection?.location_type === "cloud";
  const files = useQuery({
    queryKey: queryKeys.connections.files(id),
    queryFn: () => api.connections.files(id),
    enabled: cloud,
  });

  const isLoading = connLoading || schemaLoading || accountsLoading || providersLoading;
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

  const account = accounts.find((a) => a.id === connection.cloud_account_id);
  const provider = schema.find((s) => s.id === account?.provider_id);

  // Only the files some provider of this connection's kind can read.
  const extensions = providers
    .filter((p) => p.kind === "both" || p.kind === (connection.kind === "data" ? "data" : "schema"))
    .flatMap((p) => p.extensions);
  const listed = files.data ?? [];
  const readable = extensions.length
    ? listed.filter((f) => extensions.includes(f.path.split(".").pop()?.toLowerCase() ?? ""))
    : listed;

  const { name } = connection;
  function copyReference(path: string) {
    navigator.clipboard.writeText(`@${name}/${path}`);
    toast.create({ title: "Reference copied", type: "success" });
  }

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <DataList className="grid gap-x-12 sm:grid-cols-3" orientation="vertical">
          {cloud && (
            <DataListItem>
              <DataListItemLabel>Cloud Account</DataListItemLabel>
              <DataListItemValue className="flex items-center gap-2 font-medium">
                {provider &&
                  createElement(getProviderIcon(provider.icon), {
                    className: "size-4 text-muted-foreground",
                  })}
                {account?.name ?? connection.cloud_account_id}
              </DataListItemValue>
            </DataListItem>
          )}
          <DataListItem>
            <DataListItemLabel>URL</DataListItemLabel>
            <DataListItemValue className="break-all font-mono">{connection.url}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Location</DataListItemLabel>
            <DataListItemValue>{cloud ? "Cloud" : "Local"}</DataListItemValue>
          </DataListItem>
        </DataList>

        {cloud && (
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
