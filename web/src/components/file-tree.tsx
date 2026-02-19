"use client";

import { useMemo, useState } from "react";
import { File, Folder, FolderOpen } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/lib/types";

interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  entry?: FileEntry;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", fullPath: "", children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = { name: part, fullPath, children: [] };
        current.children.push(child);
      }

      if (i === parts.length - 1) {
        child.entry = file;
      }

      current = child;
    }
  }

  return sortNodes(root.children);
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const aIsDir = a.children.length > 0 && !a.entry;
    const bIsDir = b.children.length > 0 && !b.entry;
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

interface FileTreeProps {
  files: FileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.fullPath}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNodeItem({ node, depth, selectedPath, onSelect }: TreeNodeItemProps) {
  const [open, setOpen] = useState(true);
  const isDir = node.children.length > 0 && !node.entry;
  const isFile = !!node.entry;
  const isSelected = selectedPath === node.entry?.path;

  const indent = depth * 12;

  if (isDir) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="px-1" style={{ paddingLeft: `${indent + 4}px` }}>
          <CollapsibleTrigger asChild>
            <button
              className="flex w-full items-center gap-1.5 px-2 py-1 text-xs hover:bg-accent/50 rounded-sm"
            >
              {open ? (
                <FolderOpen size={14} className="text-muted-foreground shrink-0" />
              ) : (
                <Folder size={14} className="text-muted-foreground shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          {sortNodes(node.children).map((child) => (
            <TreeNodeItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  if (isFile) {
    return (
      <div className="px-1" style={{ paddingLeft: `${indent + 4}px` }}>
        <button
          className={cn(
            "flex w-full items-center gap-1.5 px-2 py-1 text-xs hover:bg-accent/50 rounded-sm font-mono",
            isSelected && "bg-accent",
          )}
          onClick={() => onSelect(node.entry!.path)}
        >
          <File size={14} className="text-muted-foreground shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
    );
  }

  return null;
}
