"use client";

import {
  Button,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  TreeView,
  TreeViewBranch,
  TreeViewBranchContent,
  TreeViewBranchItem,
  TreeViewContent,
  TreeViewItem,
  TreeViewNode,
  TreeViewTree,
} from "@kanzo-tech/ui";
import { BookMarked, Database, FileText, PlugZap } from "lucide-react";
import type { Format } from "@fossil-lang/types";
import type { StorageConnection } from "@/lib/connections";
import { ProblemView } from "@/components/problem-view";
import type { SourceNode } from "./sources";
import { useSources } from "./use-sources";

/**
 * The files a program can read, by connection and folder, each folder listed when it is opened —
 * Ark's lazy tree over the connection's files. Drag a file into the program, or Insert it at the
 * caret: either writes its whole binding line, its reader picked by fossil from the extension.
 */
export function StudioSources({
  connections,
  formats,
  problem,
  onInsert,
}: {
  /** The program's sources: every connection but the sink, which output is written to. */
  connections: StorageConnection[];
  formats: readonly Format[];
  /** Why the program's references could not be read. */
  problem: unknown;
  onInsert: (text: string) => void;
}) {
  const sources = useSources(connections, formats);

  if (connections.length === 0) {
    return (
      <EmptyRoot>
        <EmptyHeader>
          <EmptyIndicator variant="icon">
            <PlugZap />
          </EmptyIndicator>
          <EmptyTitle asChild>
            <h3>No connections yet</h3>
          </EmptyTitle>
          <EmptyDescription>
            A graph reads through a connection. Wire one under Connections and its files are listed here.
          </EmptyDescription>
        </EmptyHeader>
      </EmptyRoot>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {problem !== undefined && <ProblemView error={problem} />}
      <p className="text-muted-foreground text-xs">Drag a file into the program, or Insert it at the caret.</p>
      <TreeView translations={{ treeLabel: "Sources" }} {...sources}>
        <TreeViewTree>
          {sources.collection.rootNode.children?.map((node, index) => (
            <Source indexPath={[index]} key={node.id} node={node} onInsert={onInsert} />
          ))}
        </TreeViewTree>
      </TreeView>
    </div>
  );
}

function Source({
  node,
  indexPath,
  onInsert,
}: {
  node: SourceNode;
  indexPath: number[];
  onInsert: (text: string) => void;
}) {
  if (node.kind !== "file") {
    const connection = node.kind === "connection";
    return (
      <TreeViewNode indexPath={indexPath} node={node}>
        <TreeViewBranch>
          <TreeViewBranchItem expandedIcon={connection ? Database : undefined} icon={connection ? Database : undefined}>
            <span className={connection ? "font-mono" : undefined}>{node.name}</span>
          </TreeViewBranchItem>
          {node.children === undefined && node.problem !== undefined && <ProblemView error={node.problem} />}
          <TreeViewBranchContent>
            {node.children?.map((child, index) => (
              <Source indexPath={[...indexPath, index]} key={child.id} node={child} onInsert={onInsert} />
            ))}
          </TreeViewBranchContent>
        </TreeViewBranch>
      </TreeViewNode>
    );
  }
  const { line } = node;
  return (
    <TreeViewNode indexPath={indexPath} node={node}>
      {/* CodeMirror's own drop handling writes `text/plain` at the drop cursor. */}
      <TreeViewContent
        className="group/source cursor-grab font-mono active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData("text/plain", line);
        }}
      >
        <TreeViewItem icon={node.vocabulary ? BookMarked : FileText}>{node.name}</TreeViewItem>
        <span className="text-faint text-xs">{node.vocabulary ? "vocabulary · " : ""}io.{node.reader}</span>
        <Button
          className="font-sans opacity-0 group-hover/source:opacity-100 group-data-focus/source:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onInsert(line);
          }}
          size="sm"
          variant="outline"
        >
          Insert
        </Button>
      </TreeViewContent>
    </TreeViewNode>
  );
}
