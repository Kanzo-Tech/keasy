"use client";

import { useState } from "react";
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
  createTreeCollection,
} from "@kanzo-tech/ui";
import { BookMarked, Database, FileText, PlugZap } from "lucide-react";
import type { Format } from "@fossil-lang/types";
import { $api } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import type { StorageConnection } from "@/lib/connections";
import { ProblemView } from "@/components/problem-view";
import { childrenOf, connectionNode, type SourceNode } from "./sources";

const KIND = { data: { icon: Database, label: "data" }, vocab: { icon: BookMarked, label: "vocabulary" } } as const;

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
  const [collection, setCollection] = useState(() =>
    createTreeCollection<SourceNode>({
      rootNode: { id: "", name: "", children: connections.map(connectionNode) },
    }),
  );
  const [failed, setFailed] = useState<unknown>(undefined);

  const loadChildren = async ({ node }: { node: SourceNode }) => {
    const { files } = await queryClient.fetchQuery(
      $api.queryOptions("get", "/v1/connections/{name}/files", {
        params: { path: { name: node.connection!.name }, query: node.under ? { prefix: node.under } : {} },
      }),
    );
    return childrenOf(
      node,
      files.map((f) => f.path),
      formats,
    );
  };

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
      {failed !== undefined && <ProblemView error={failed} />}
      <p className="text-muted-foreground text-xs">Drag a file into the program, or Insert it at the caret.</p>
      <TreeView
        aria-label="Sources"
        collection={collection}
        loadChildren={loadChildren}
        onLoadChildrenComplete={(d) => {
          setFailed(undefined);
          setCollection(d.collection);
        }}
        onLoadChildrenError={(d) => setFailed(d.nodes[0]?.error)}
      >
        <TreeViewTree>
          {collection.rootNode.children?.map((node, index) => (
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
  const line = node.line;
  const kind = node.connection && node.under === "" ? KIND[node.connection.kind] : undefined;
  return (
    <TreeViewNode indexPath={indexPath} node={node}>
      {line === undefined ? (
        <TreeViewBranch>
          <TreeViewBranchItem expandedIcon={kind?.icon} icon={kind?.icon}>
            <span className={kind ? "font-mono" : undefined}>{node.name}</span>
            {kind && <span className="text-faint text-xs">{kind.label}</span>}
          </TreeViewBranchItem>
          <TreeViewBranchContent>
            {node.children?.map((child, index) => (
              <Source indexPath={[...indexPath, index]} key={child.id} node={child} onInsert={onInsert} />
            ))}
          </TreeViewBranchContent>
        </TreeViewBranch>
      ) : (
        // CodeMirror's own drop handling writes `text/plain` at the drop cursor.
        <TreeViewContent
          className="group/source cursor-grab font-mono active:cursor-grabbing"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData("text/plain", line);
          }}
        >
          <TreeViewItem icon={FileText}>{node.name}</TreeViewItem>
          <span className="text-faint text-xs">io.{node.reader}</span>
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
      )}
    </TreeViewNode>
  );
}
