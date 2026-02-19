"use client";

import React, { use, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/hooks/use-async";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  fetchConnections,
  fetchSchema,
  fetchCloudAccounts,
  fetchConnectionFiles,
  downloadConnectionFile,
} from "@/lib/api";
import { CodeBlock } from "@/components/code-block";
import { MetaItem } from "@/components/meta-item";
import { FileTree } from "@/components/file-tree";
import { getProviderIcon } from "@/lib/provider-icons";
import type { FileEntry } from "@/lib/types";

export default function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, loading } = useAsync(
    () => Promise.all([fetchConnections(), fetchSchema(), fetchCloudAccounts()]),
    [id],
  );

  const [conns, schema, accounts] = data ?? [[], [], []];
  const connection = conns.find((c) => c.id === id) ?? null;
  const account = connection ? accounts.find((a) => a.id === connection.cloud_account_id) : null;
  const provider = account ? (schema.find((s) => s.id === account.provider_id) ?? null) : null;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setFilesLoading(true);
    fetchConnectionFiles(id)
      .then(setFiles)
      .catch(() => {
        toast.error("Failed to list files");
        setFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [id, connection]);

  function langForPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ttl: "turtle", json: "json", jsonld: "json", rdf: "xml",
      owl: "xml", xml: "xml", nt: "text", nq: "text", csv: "csv",
      tsv: "csv", yaml: "yaml", yml: "yaml", shex: "text",
      md: "markdown", txt: "text",
    };
    return map[ext] ?? "text";
  }

  async function handleFileSelect(path: string) {
    if (selectedPath === path) return;
    setSelectedPath(path);
    setPreviewLoading(true);
    try {
      const content = await downloadConnectionFile(id, path);
      setPreviewContent(content);
    } catch {
      toast.error("Failed to load file content");
      setSelectedPath(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!connection) {
    return <p className="text-muted-foreground">Connection not found.</p>;
  }

  const Icon = provider ? getProviderIcon(provider.icon) : null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={connection.name}
        backHref="/connections"
        backLabel="Connections"
        action={undefined}
      />

      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Cloud Account</p>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <p className="text-sm font-medium">{account?.name ?? connection.cloud_account_id}</p>
          </div>
        </div>
        <MetaItem label="Container URL" value={connection.container_url} mono />
      </div>

      <h3 className="text-sm font-medium mb-2">Files</h3>
      {filesLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          Loading files...
        </div>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files found.</p>
      ) : (
        <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={25} minSize={20}>
              <ScrollArea className="h-full">
                <FileTree
                  files={files}
                  selectedPath={selectedPath}
                  onSelect={handleFileSelect}
                />
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={75}>
              <div className="flex flex-col h-full overflow-auto [&_[data-shiki]]:rounded-none [&_[data-shiki]_pre]:rounded-none">
                {selectedPath === null ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Select a file to preview
                  </div>
                ) : previewLoading ? (
                  <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />
                    Loading file...
                  </div>
                ) : (
                  <CodeBlock code={previewContent} lang={langForPath(selectedPath)} />
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  );
}
