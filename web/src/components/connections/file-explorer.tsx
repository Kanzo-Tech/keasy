"use client";

import { useMemo } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FileEntry, ProviderInfo, ConnectionKind } from "@/lib/types";
import { formatSize } from "@/lib/formatters";

interface FileExplorerProps {
  connectionName: string;
  connectionKind: ConnectionKind;
  files: FileEntry[];
  isLoading: boolean;
  providers: ProviderInfo[];
}

export function FileExplorer({
  connectionName,
  connectionKind,
  files,
  isLoading,
  providers,
}: FileExplorerProps) {
  const filtered = useMemo(() => {
    const supportedExts = providers
      .filter((p) =>
        connectionKind === "data"
          ? p.kind === "data" || p.kind === "both"
          : p.kind === "schema" || p.kind === "both",
      )
      .flatMap((p) => p.extensions);

    return supportedExts.length > 0
      ? files.filter((f) => {
          const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
          return supportedExts.includes(ext);
        })
      : files;
  }, [files, providers, connectionKind]);

  function copyRef(path: string) {
    navigator.clipboard.writeText(`@${connectionName}/${path}`);
    toast.success("Reference copied");
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Files</h3>

      {isLoading ? (
        <div className="border rounded-md p-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files found.</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No supported files found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Path</TableHead>
              <TableHead className="w-24 text-right">Size</TableHead>
              <TableHead style={{ width: "48px" }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((f) => (
              <TableRow key={f.path}>
                <TableCell className="font-mono text-xs">{f.path}</TableCell>
                <TableCell className="text-xs text-muted-foreground text-right">
                  {formatSize(f.size)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => copyRef(f.path)}>
                        Copy reference
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
