"use client";

import { useMemo } from "react";
import {
  Checkbox,
  TreeView,
  TreeViewBranch,
  TreeViewBranchContent,
  TreeViewBranchItem,
  TreeViewContent,
  TreeViewItem,
  TreeViewNode,
  TreeViewTree,
  createTreeCollection,
} from "@kanzo-tech/ui";
import { Database, FileSpreadsheet, FileText, Folder } from "lucide-react";
import { ProblemView } from "@/components/problem-view";
import { checkState, type SourceTree, type SourceTreeNode, toggle } from "./model";

/** A table's file reads as one; anything else as a document. */
const FILE_ICONS = {
  ".csv": FileSpreadsheet,
  ".tsv": FileSpreadsheet,
  ".parquet": FileSpreadsheet,
  ".xlsx": FileSpreadsheet,
};

const bytes = new Intl.NumberFormat("en", { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow" });
const size = (n: number) => bytes.format(n).replace(/(\d)([KMGT]?B)$/, "$1 $2");

interface Node {
  id: string;
  name: string;
  source: SourceTreeNode;
  children?: Node[];
  childrenCount?: number;
}

/**
 * Ark's tree over the data. A branch says it is one by `childrenCount` (Ark's lazy branch), so an
 * unlisted folder still opens and a listed empty one is still a folder.
 */
function toNode(source: SourceTreeNode): Node {
  const { id, name } = source;
  if (source.kind === "file") return { id, name, source };
  const children = source.children?.map(toNode);
  return { id, name, source, children, childrenCount: children?.length ?? 1 };
}

export interface SourcePickerProps {
  tree: SourceTree;
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
  /** The branches open, by id. */
  expanded: readonly string[];
  onExpandedChange: (expanded: string[]) => void;
}

/**
 * The files to read, as a tree: connection, folders, files. A box beside each file picks it, and a
 * folder's box picks every file listed under it. A folder is listed when it is opened, so one never
 * opened has no box yet: nobody picks what they have not seen.
 */
export function SourcePicker({ tree, selected, onSelectedChange, expanded, onExpandedChange }: SourcePickerProps) {
  const collection = useMemo(
    () => createTreeCollection<Node>({ rootNode: { id: "", name: "", children: tree.roots.map(toNode) } as Node }),
    [tree],
  );
  return (
    <TreeView
      aria-label="Files"
      collection={collection}
      fileIcons={FILE_ICONS}
      expandedValue={[...expanded]}
      onExpandedChange={(d) => onExpandedChange(d.expandedValue)}
    >
      <TreeViewTree>
        {collection.rootNode.children?.map((node, index) => (
          <Branch indexPath={[index]} key={node.id} node={node} onSelectedChange={onSelectedChange} selected={selected} />
        ))}
      </TreeViewTree>
    </TreeView>
  );
}

function Pick({
  node,
  selected,
  onSelectedChange,
}: {
  node: SourceTreeNode;
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
}) {
  const state = checkState(node, selected);
  if (state === null) return null;
  return (
    // The box sits inside the row Ark presses to open a folder: its press is its own.
    <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Checkbox
        aria-label={`Pick ${node.name}`}
        checked={state}
        onCheckedChange={() => onSelectedChange(toggle(node, selected))}
      />
    </span>
  );
}

function Branch({
  node,
  indexPath,
  selected,
  onSelectedChange,
}: {
  node: Node;
  indexPath: number[];
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
}) {
  const { source } = node;
  if (source.kind === "file") {
    return (
      <TreeViewNode indexPath={indexPath} node={node}>
        <TreeViewContent>
          <Pick node={source} onSelectedChange={onSelectedChange} selected={selected} />
          <TreeViewItem icon={FileText}>{node.name}</TreeViewItem>
          {source.size !== undefined && (
            <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums">{size(source.size)}</span>
          )}
        </TreeViewContent>
      </TreeViewNode>
    );
  }
  const connection = source.kind === "connection";
  return (
    <TreeViewNode indexPath={indexPath} node={node}>
      <TreeViewBranch>
        {/* The box before the icon, as a file's row has it: the icons are drawn here, not by the title. */}
        <TreeViewBranchItem expandedIcon={null} icon={null}>
          <Pick node={source} onSelectedChange={onSelectedChange} selected={selected} />
          {connection ? <Database aria-hidden /> : <Folder aria-hidden />}
          <span className={connection ? "font-medium text-foreground" : undefined}>{node.name}</span>
        </TreeViewBranchItem>
        <TreeViewBranchContent>
          {source.problem !== undefined && <ProblemView error={source.problem} />}
          {source.children?.length === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">No files here that can be read.</p>
          )}
          {node.children?.map((child, index) => (
            <Branch
              indexPath={[...indexPath, index]}
              key={child.id}
              node={child}
              onSelectedChange={onSelectedChange}
              selected={selected}
            />
          ))}
        </TreeViewBranchContent>
      </TreeViewBranch>
    </TreeViewNode>
  );
}
