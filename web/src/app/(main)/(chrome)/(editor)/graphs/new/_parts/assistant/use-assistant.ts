"use client";

/**
 * The one adaptor between what keasy can read and what the assistant's turns draw (`model.ts`).
 * The turns compute nothing; everything they show is answered here.
 *
 * What it answers, from real data: the tree, from the connections' listings (`sources.ts`'s
 * `childrenOf`, the studio's); one thing per file with its count and columns, from fossil's profile
 * of the picked files, read once over all of them (`tasks/profile.ts`) — before any model is asked;
 * and then the Tasks of docs/design/assistant.md, in order, on the page's model (`useModel`):
 * `model` once the files are read and *what is it about?* is answered — the relations and the
 * decisions; `requirements` once its decisions are taken — the question chips (`useTask`), and
 * whether each question kept is answerable; `mapping` once the person has asked all they wanted —
 * the program **Advanced** opens. What stays `null` is the preview build (`emit`, then the
 * executor). A Task that fails is in `failures`, with its retry.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTask } from "@kanzo-tech/ai";
import { runTask } from "@kanzo-tech/ai/task";
import type { Format } from "@fossil-lang/types";
import { inputs, profile } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/ui/analytics";
import { $api } from "@/lib/api/client";
import type { StorageConnection } from "@/lib/connections";
import { host } from "@/lib/fossil/host";
import { childrenOf, connectionNode, type SourceNode } from "../sources";
import { useModel } from "@/lib/ai";
import { type AssistantData, type DecisionItem, optionOf, type Question, type QuestionOffer, type SourceTreeNode, type TaskFailure, type Thing } from "./model";
import { fossilCheck, mapping, mappingInput, programOf } from "./tasks/mapping";
import { accept, type Accepted, decisionsOf, defaultsOf, type Draft, modelTask, relationsOf } from "./tasks/model";
import { type Profiled, profiledOf, thingName } from "./tasks/profile";
import { isAnswerable, requirements } from "./tasks/requirements";
import { spoken } from "./tasks/words";

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

/**
 * The decisions a draft raises, each with the default the profile settles it with, if any, and the
 * person's pick over it.
 */
export function decisionItems(draft: Draft, profiled: Profiled, chosen: Readonly<Record<string, string>>): DecisionItem[] {
  const defaults = defaultsOf(profiled);
  return decisionsOf(draft, profiled).map((decision) => ({
    decision,
    assumed: defaults[decision.id]?.assume ?? null,
    chosen: chosen[decision.id] ?? null,
  }));
}

/** A refused artefact as a failure: what its oracles still said after the last attempt. */
class Refused extends Error {
  override readonly name = "Refused";
  constructor(task: string, diagnostics: readonly { message: string }[]) {
    super(`The ${task} proposed did not hold: ${diagnostics.map((d) => d.message).join(" ")}`);
  }
}

const NO_MODEL: Accepted = { types: [], edges: [] };

/** The option the decision `id` stands at: the person's pick, else its default. */
function standing(items: readonly DecisionItem[], id: string): string | null {
  const item = items.find((d) => d.decision.id === id);
  return item ? optionOf(item) : null;
}

export interface Assistant extends AssistantData {
  /** The person's questions, each with whether these files can answer it. */
  questions: Question[];
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
  about,
  asked,
  questions,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
  /** *What is it about?*: `undefined` until answered, `""` when skipped. */
  about: string | undefined;
  /** The person has asked all they wanted. */
  asked: boolean;
  /** The questions the person kept, whose `answerable` this answers. */
  questions: readonly Question[];
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

  const model = useModel();

  // ── model: the types, once the files are read and what it is about is said ──
  const drafted = useQuery({
    queryKey: ["assistant", "model", lines, about],
    queryFn: async ({ signal }) => {
      const proposal = await runTask(modelTask(profiled!), { profiled: profiled!, about: about ?? "" }, { model, signal });
      if ("diagnostics" in proposal.verdict) throw new Refused("model", proposal.verdict.diagnostics);
      return proposal.value;
    },
    enabled: profiled !== null && profiled.sources.length > 0 && about !== undefined,
    retry: false,
    staleTime: Infinity,
  });
  const draft = drafted.data ?? null;
  const decisions = useMemo(() => (draft && profiled ? decisionItems(draft, profiled, chosen) : null), [draft, profiled, chosen]);
  const accepted = useMemo(
    () => (draft && profiled && decisions ? accept(draft, profiled, (id) => standing(decisions, id)) : null),
    [draft, profiled, decisions],
  );
  // Said before the decisions are taken: each one still open read at its first option meanwhile.
  const relations = useMemo(() => {
    if (!draft || !profiled || !decisions) return null;
    const first = (id: string) => decisions.find((d) => d.decision.id === id)?.decision.options[0]?.id ?? null;
    const shown = accepted ?? accept(draft, profiled, (id) => standing(decisions, id) ?? first(id));
    return shown ? relationsOf(shown, profiled) : null;
  }, [draft, profiled, decisions, accepted]);
  const acceptedKey = accepted ? JSON.stringify(accepted) : null;

  // ── requirements: questions to start from, once the model is accepted ──
  const offered = useTask(requirements, { accepted: accepted ?? NO_MODEL, about: about ?? "" }, { model });
  const propose = useRef(offered.propose);
  propose.current = offered.propose;
  useEffect(() => {
    if (acceptedKey !== null) propose.current();
  }, [acceptedKey]);
  const offers: QuestionOffer[] | null =
    accepted && offered.state === "ready"
      ? offered.proposals.map((p) => ({ id: p.id, text: p.value.text, rationale: `Reads ${p.value.fields.map((f) => spoken(f.slice(f.indexOf(".") + 1))).join(", ")}` }))
      : null;
  // A chip is answerable by construction: the resolver reached it before it was offered.
  const offeredTexts = new Set((offers ?? []).map((o) => o.text));
  const typed = questions.filter((q) => !offeredTexts.has(q.text));
  const marked = useQueries({
    queries: typed.map((q) => ({
      queryKey: ["assistant", "answerable", acceptedKey, q.text],
      queryFn: ({ signal }: { signal: AbortSignal }) => isAnswerable(q.text, accepted!, profiled!, { model, signal }),
      enabled: accepted !== null,
      retry: false,
      staleTime: Infinity,
    })),
  });
  const answerable = (q: Question): boolean | null => {
    if (!accepted) return null;
    if (offeredTexts.has(q.text)) return true;
    return marked[typed.indexOf(q)]?.data ?? null;
  };

  // ── mapping: the program, once the person has asked all they wanted ──
  const mapped = useQuery({
    queryKey: ["assistant", "mapping", acceptedKey],
    queryFn: async ({ signal }) => {
      const check = fossilCheck({ host, engine: await engine({ signal }) });
      try {
        const input = await mappingInput(accepted!, profiled!, { base: window.location.origin, check, signal });
        const proposal = await runTask(mapping, input, { model, signal });
        if ("diagnostics" in proposal.verdict) throw new Refused("mapping", proposal.verdict.diagnostics);
        return programOf(input, proposal.value);
      } finally {
        check.close();
      }
    },
    enabled: accepted !== null && asked,
    retry: false,
    staleTime: Infinity,
  });

  const failures: TaskFailure[] = [
    ...(drafted.isError ? [{ task: "model" as const, problem: drafted.error, retry: () => void drafted.refetch() }] : []),
    ...(offered.state === "failed" ? [{ task: "requirements" as const, problem: offered.error, retry: () => offered.propose() }] : []),
    ...(mapped.isError ? [{ task: "mapping" as const, problem: mapped.error, retry: () => void mapped.refetch() }] : []),
  ];

  return {
    sources: tree,
    selected,
    reading: picked.length > 0 && read.isPending ? { done: 0, total: picked.length } : null,
    problems,
    understanding: { things: profiled ? thingsOf(profiled, picked) : [], relations },
    offers,
    decisions,
    // The preview waits on `emit` and the executor in a worker: not built yet.
    build: null,
    failures,
    questions: questions.map((q) => ({ ...q, answerable: answerable(q) })),
    expanded,
    setExpanded,
    setSelected,
    choose: (decision, option) => setChosen((prev) => ({ ...prev, [decision]: option })),
    // The mapping's program once it holds; until then the picked files' bindings.
    program: mapped.data ?? picked.map((f) => f.line).join("\n"),
  };
}
