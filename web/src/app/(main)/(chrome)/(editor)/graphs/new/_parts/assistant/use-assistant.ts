"use client";

/**
 * The one adaptor between what keasy can read and what the assistant's turns draw (`model.ts`).
 * The turns compute nothing; everything they show is answered here.
 *
 * What it answers today, from real data: the tree, from the connections' listings (`sources.ts`'s
 * `childrenOf`, the studio's); and one thing per file with its count and columns, from fossil's
 * profile of the picked files, read once over all of them (`tasks/profile.ts`). What it leaves
 * `null`, typed, for the Tasks of docs/design/assistant.md: relations and decisions (`model`,
 * `mapping`), question offers and whether a question is answerable (`requirements`), and the
 * preview build (`emit`, then the executor). Nothing here calls a model.
 */

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Format } from "@fossil-lang/types";
import { inputs, profile } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/ui/analytics";
import { $api } from "@/lib/api/client";
import type { StorageConnection } from "@/lib/connections";
import { host } from "@/lib/fossil/host";
import { childrenOf, connectionNode, type SourceNode } from "../sources";
import type { AssistantData, DecisionItem, SourceTreeNode, Thing } from "./model";
import { type Profiled, profiledOf, thingName } from "./tasks/profile";

/** A picked file as the program reads it: its whole binding line. */
interface FileEntry {
  id: string;
  name: string;
  line: string;
}

/** The rows the profile keeps of each file: enough for one row of each relation to be found across files. */
const SHOWN = 50;

/** One thing per file read, with its count and what it holds: what the profile says before any model. */
export function thingsOf(profiled: Profiled, picked: readonly FileEntry[]): Thing[] {
  return profiled.sources.map((s) => ({
    id: picked.find((f) => f.line.includes(`"${s.key}"`))?.id ?? s.key,
    name: thingName(s.file),
    count: s.rows,
    holds: s.columns.map((c) => c.name),
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
  const lines = picked.map((f) => f.line).sort();
  // The files are read together, once: the inclusions between two of them are part of the answer.
  const read = useQuery({
    queryKey: ["assistant", "profile", lines],
    queryFn: async ({ signal }) => {
      const sources = await inputs(lines.join("\n"), { host, signal });
      const { profile: answer, undescribed } = await profile(sources, {
        host,
        engine: await engine({ signal }),
        options: { shown: SHOWN },
        signal,
      });
      return { profiled: profiledOf(answer, sources), undescribed };
    },
    enabled: picked.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  const profiled = read.data?.profiled ?? null;
  const problems: { id: string; problem: unknown }[] = read.error
    ? [{ id: "profile", problem: read.error }]
    : (read.data?.undescribed ?? []).map(({ source, problem }) => ({
        id: picked.find((f) => f.line.includes(`"${source.key}"`))?.id ?? source.key,
        problem,
      }));

  return {
    sources: tree,
    selected,
    reading: picked.length > 0 && read.isPending ? { done: 0, total: picked.length } : null,
    problems,
    // Seams, each `null` a Task's to fill: `relations` and the decisions are `model`'s and
    // `mapping`'s, `offers` is `requirements`', and `build` waits on a program to build.
    understanding: { things: profiled ? thingsOf(profiled, picked) : [], relations: null },
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
