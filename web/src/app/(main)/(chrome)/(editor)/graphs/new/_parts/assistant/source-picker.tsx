"use client";

import {
  TreeView,
  TreeViewBranch,
  TreeViewBranchContent,
  TreeViewBranchItem,
  TreeViewCheckbox,
  TreeViewContent,
  TreeViewItem,
  TreeViewNode,
  TreeViewTree,
  useTreeView,
} from "@kanzo-tech/ui";
import { Database, FileSpreadsheet, FileText, Folder } from "lucide-react";
import { ProblemView } from "@/components/problem-view";
import type { SourceNode } from "../sources";
import type { Sources } from "../use-sources";

/** A table's file reads as one; anything else as a document. */
const FILE_ICONS = {
  ".csv": FileSpreadsheet,
  ".tsv": FileSpreadsheet,
  ".parquet": FileSpreadsheet,
  ".xlsx": FileSpreadsheet,
};

const bytes = new Intl.NumberFormat("en", { notation: "compact", style: "unit", unit: "byte", unitDisplay: "narrow" });
const size = (n: number) => bytes.format(n).replace(/(\d)([KMGT]?B)$/, "$1 $2");

export interface SourcePickerProps {
  sources: Sources;
  /** The picked files, by id: the tree's checked value. */
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
  /** The branches open, by id. */
  expanded: readonly string[];
  onExpandedChange: (expanded: string[]) => void;
}

/**
 * The files to read, as a tree: connection, folders, files, each folder listed when it is opened. A
 * box beside each file picks it, and a folder's box picks every file listed under it — Ark's checked
 * state, mixed when some are. A folder with nothing listed under it has no box yet: nobody picks what
 * they have not seen.
 */
export function SourcePicker({ sources, selected, onSelectedChange, expanded, onExpandedChange }: SourcePickerProps) {
  return (
    <TreeView
      translations={{ treeLabel: "Files" }}
      {...sources}
      checkedValue={[...selected]}
      expandedValue={[...expanded]}
      fileIcons={FILE_ICONS}
      onCheckedChange={(d) => onSelectedChange(new Set(d.checkedValue))}
      onExpandedChange={(d) => onExpandedChange(d.expandedValue)}
    >
      <TreeViewTree>
        {sources.collection.rootNode.children?.map((node, index) => (
          <Branch indexPath={[index]} key={node.id} node={node} />
        ))}
      </TreeViewTree>
    </TreeView>
  );
}

/** A node's box, once something under it is listed to pick. */
function Pick({ node }: { node: SourceNode }) {
  const { collection } = useTreeView();
  if (node.kind !== "file" && collection.getDescendantValues(node.id).length === 0) return null;
  return <TreeViewCheckbox aria-label={`Pick ${node.name}`} />;
}

function Branch({ node, indexPath }: { node: SourceNode; indexPath: number[] }) {
  if (node.kind === "file") {
    return (
      <TreeViewNode indexPath={indexPath} node={node}>
        <TreeViewContent>
          <Pick node={node} />
          <TreeViewItem icon={FileText}>{node.name}</TreeViewItem>
          <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums">{size(node.size)}</span>
        </TreeViewContent>
      </TreeViewNode>
    );
  }
  const connection = node.kind === "connection";
  return (
    <TreeViewNode indexPath={indexPath} node={node}>
      <TreeViewBranch>
        {/* The box before the icon, as a file's row has it: the icons are drawn here, not by the title. */}
        <TreeViewBranchItem expandedIcon={null} icon={null}>
          <Pick node={node} />
          {connection ? <Database aria-hidden /> : <Folder aria-hidden />}
          <span className={connection ? "font-medium text-foreground" : undefined}>{node.name}</span>
        </TreeViewBranchItem>
        {node.children === undefined && node.problem !== undefined && <ProblemView error={node.problem} />}
        <TreeViewBranchContent>
          {node.children?.length === 0 && (
            <p className="px-2 py-1 text-muted-foreground text-xs">No files here that can be read.</p>
          )}
          {node.children?.map((child, index) => (
            <Branch indexPath={[...indexPath, index]} key={child.id} node={child} />
          ))}
        </TreeViewBranchContent>
      </TreeViewBranch>
    </TreeViewNode>
  );
}
