"use client";

import { useState } from "react";
import type { Format } from "@fossil-lang/types";
import { $api } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import type { StorageConnection } from "@/lib/connections";
import { childrenOf, connectionNode, type SourceNode, sourceCollection } from "./sources";

type Collection = ReturnType<typeof sourceCollection>;

/** The tree of a program's sources and the way it lists a branch: Ark's TreeView props, spread onto it. */
export interface Sources {
  collection: Collection;
  loadChildren: (details: { node: SourceNode }) => Promise<SourceNode[]>;
  onLoadChildrenComplete: (details: { collection: Collection }) => void;
  onLoadChildrenError: (details: { nodes: { node: SourceNode; error: unknown; indexPath: number[] }[] }) => void;
}

/**
 * The tree over `connections`, each branch listed (`/v1/connections/{name}/files`) the first time it
 * is opened, as Ark's lazy tree loads it, and kept listed after. A listing that fails is that
 * branch's `problem`.
 */
export function useSources(connections: readonly StorageConnection[], formats: readonly Format[]): Sources {
  const [collection, setCollection] = useState(() => sourceCollection(connections.map(connectionNode)));
  return {
    collection,
    loadChildren: async ({ node }) => {
      if (node.kind === "file") return [];
      const { connection, under } = node;
      const { files } = await queryClient.fetchQuery(
        $api.queryOptions("get", "/v1/connections/{name}/files", {
          params: { path: { name: connection.name }, ...(under && { query: { prefix: under } }) },
        }),
      );
      return childrenOf(node, files, formats);
    },
    onLoadChildrenComplete: (d) => setCollection(d.collection),
    onLoadChildrenError: ({ nodes }) =>
      setCollection((c) =>
        nodes.reduce((at, { node, error, indexPath }) => (node.kind === "file" ? at : at.replace(indexPath, { ...node, problem: error })), c),
      ),
  };
}
