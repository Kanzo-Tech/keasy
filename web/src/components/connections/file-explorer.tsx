"use client";

import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
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
import type { FileEntry } from "@/lib/types";
import { formatSize } from "@/lib/formatters";

interface FileExplorerProps {
  connectionName: string;
  files: FileEntry[];
  isLoading: boolean;
}

export function FileExplorer({
  connectionName,
  files,
  isLoading,
}: FileExplorerProps) {
  const showSkeleton = useDelayedLoading(isLoading);

  function copyRef(path: string) {
    navigator.clipboard.writeText(`@${connectionName}/${path}`);
    toast.success("Reference copied");
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
                  <TableCell><Skeleton loading className="block"><span className="font-mono text-xs">example/file.csv</span></Skeleton></TableCell>
                  <TableCell className="text-right"><Skeleton loading className="block"><span className="text-xs">1.2 KB</span></Skeleton></TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files found.</p>
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
            {files.map((f) => (
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
