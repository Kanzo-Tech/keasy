"use client";

import { useMemo } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "@kanzo-tech/ui";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kanzo-tech/ui";
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

  const showSkeleton = useDelayedLoading(isLoading);

  function copyRef(path: string) {
    navigator.clipboard.writeText(`@${connectionName}/${path}`);
    toast.create({ title: "Reference copied", type: "success" });
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Files</h3>

      {isLoading ? (
        showSkeleton ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="w-24 text-right">Size</TableHead>
                <TableHead style={{ width: "48px" }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell className="text-end"><Skeleton className="ms-auto h-4 w-12" /></TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null
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
                  <Menu positioning={{ placement: "bottom-end" }}>
                    <MenuTrigger asChild>
                      <Button aria-label="Open file actions" size="icon-sm" variant="ghost">
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => copyRef(f.path)} value="copy-reference">
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
    </div>
  );
}
