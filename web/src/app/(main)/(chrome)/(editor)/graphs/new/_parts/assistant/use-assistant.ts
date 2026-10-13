"use client";

/**
 * The one adaptor between what keasy can read and what the assistant's turns draw (`model.ts`).
 * The turns compute nothing; everything they show is answered here.
 *
 * What it answers today, from real data: the tree, from the connections' listings (`sources.ts`'s
 * `childrenOf`, the studio's); the reading progress and one thing per file with its columns, from
 * introspect, one file at a time so the count moves as each is read. What it leaves `null`, typed,
 * for the Tasks of docs/design/assistant.md: counts and example rows (Profile, which replaces
 * introspect), relations and decisions (`model`, `mapping`), question offers and whether a question
 * is answerable (`requirements`), and the preview build (`emit`, then the executor). Nothing here
 * calls a model.
 */

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { introspect } from "@fossil-lang/introspect";
import type { Format, InferredDescriptor } from "@fossil-lang/types";
import { inputs } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/ui/analytics";
import { $api } from "@/lib/api/client";
import type { StorageConnection } from "@/lib/connections";
import { host } from "@/lib/fossil/host";
import { childrenOf, connectionNode, type SourceNode } from "../sources";
import { sourceDescriptorsKey } from "../use-source-descriptors";
import type { AssistantData, DecisionItem, SourceTreeNode, Thing } from "./model";

/** A picked file as the program reads it: its whole binding line. */
interface FileEntry {
  id: string;
  name: string;
  line: string;
}

/** "nobel_laureates.csv" → "Nobel laureates": a file's name as a thing's, until `model` names it. */
export function thingName(file: string): string {
  const words = file.replace(/\.[^.]*$/, "").replace(/[_\-.]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : file;
}

/** One thing per file read, holding its columns: what introspect can say. */
export function thingsOf(described: readonly { file: FileEntry; descriptor: InferredDescriptor }[]): Thing[] {
  return described.map(({ file, descriptor }) => ({
    id: file.id,
    name: thingName(file.name),
    count: null,
    holds: descriptor.columns.map((c) => c.name),
  }));
}

/** What the tree reads of a listing; one reference for as long as the answers do not change. */
const answers = <T,>(results: readonly { data?: T; error: unknown }[]) =>
  results.map(({ data, error }) => ({ data, error }));

/** The decisions a Task raised, each with the person's pick over it. */
export function withChoices(
  raised: readonly DecisionItem[] | null,
  chosen: Readonly<Record<string, string>>,
): DecisionItem[] | null {
  return raised && raised.map((item) => ({ ...item, chosen: chosen[item.decision.id] ?? item.chosen }));
}

export interface Assistant extends AssistantData {
  /** The branches open in the tree. */
  expanded: readonly string[];
  setExpanded: (expanded: string[]) => void;
  setSelected: (selected: Set<string>) => void;
  /** The person's pick of a decision's option. */
  choose: (decision: string, option: string) => void;
  /** The picked files as the program's binding lines: what Advanced opens the editor with. */
  program: string;
}

export function useAssistant({
  connections,
  formats,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
}): Assistant {
  // The sink is written to, not read from.
  const roots = useMemo(
    () => connections.filter((c) => c.kind === "data" && c.direction !== "sink").map(connectionNode),
    [connections],
  );
  const [expanded, setExpandedState] = useState<string[]>([]);
  // Every branch ever opened stays listed, so a folder closed keeps its picks.
  const [listed, setListed] = useState<SourceNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const listings = useQueries({
    combine: answers,
    queries: listed.map((node) =>
      $api.queryOptions("get", "/v1/connections/{name}/files", {
        params: { path: { name: node.connection!.name }, query: node.under ? { prefix: node.under } : {} },
      }),
    ),
  });

  // The tree, built down from the roots through every listing that has answered.
  const { tree, nodes, files } = useMemo(() => {
    const byId = new Map<string, SourceNode>();
    const fileById = new Map<string, FileEntry>();
    const listingOf = new Map(listed.map((node, i) => [node.id, listings[i]]));
    // A file's size, by its node's id (`<connection>:<path>`, as `childrenOf` names it).
    const sizes = new Map<string, number>();
    const build = (node: SourceNode): SourceTreeNode => {
      byId.set(node.id, node);
      if (node.line !== undefined) {
        fileById.set(node.id, { id: node.id, name: node.name, line: node.line });
        return { id: node.id, name: node.name, kind: "file", size: sizes.get(node.id) };
      }
      const kind = node.under === "" ? "connection" : "folder";
      const listing = listingOf.get(node.id);
      if (listing?.error) return { id: node.id, name: node.name, kind, problem: listing.error };
      if (!listing?.data) return { id: node.id, name: node.name, kind };
      for (const f of listing.data.files) sizes.set(`${node.connection!.name}:${f.path}`, f.size);
      const children = childrenOf(node, listing.data.files.map((f) => f.path), formats).map(build);
      return { id: node.id, name: node.name, kind, children };
    };
    return { tree: { roots: roots.map(build) }, nodes: byId, files: fileById };
  }, [roots, listed, listings, formats]);

  const setExpanded = (next: string[]) => {
    setExpandedState(next);
    const fresh = next.filter((id) => !listed.some((n) => n.id === id)).flatMap((id) => nodes.get(id) ?? []);
    if (fresh.length > 0) setListed((prev) => [...prev, ...fresh]);
  };

  const picked = [...selected].flatMap((id) => files.get(id) ?? []);
  const described = useQueries({
    queries: picked.map((file) => ({
      queryKey: sourceDescriptorsKey([file.line]),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        introspect(await inputs(file.line, { host, signal }), { host, engine: await engine({ signal }), signal }),
      retry: false,
    })),
  });

  const done = described.filter((q) => !q.isPending).length;
  const read = picked.flatMap((file, i) =>
    (described[i]?.data?.descriptors ?? []).map((descriptor) => ({ file, descriptor })),
  );
  const problems = picked.flatMap((file, i): { id: string; problem: unknown }[] => {
    const q = described[i];
    if (q?.error) return [{ id: file.id, problem: q.error }];
    return (q?.data?.undescribed ?? []).map(({ problem }) => ({ id: file.id, problem }));
  });

  return {
    sources: tree,
    selected,
    reading: picked.length > 0 && done < picked.length ? { done, total: picked.length } : null,
    problems,
    // Seams, each `null` a Task's to fill: `relations` and the decisions are `model`'s and
    // `mapping`'s, `offers` is `requirements`', and `build` waits on a program to build.
    understanding: { things: thingsOf(read), relations: null },
    offers: null,
    decisions: withChoices(null, chosen),
    build: null,
    expanded,
    setExpanded,
    setSelected,
    choose: (decision, option) => setChosen((prev) => ({ ...prev, [decision]: option })),
    program: picked.map((f) => f.line).join("\n"),
  };
}
