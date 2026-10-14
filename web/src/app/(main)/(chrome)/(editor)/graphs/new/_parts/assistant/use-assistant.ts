"use client";

/**
 * The one adaptor between what keasy can read and what the assistant's turns draw (`model.ts`).
 * The turns compute nothing; everything they show is answered here.
 *
 * What it answers, from real data: the tree, from the connections' listings (`useSources`, the
 * studio's); one thing per file with its count and columns, from fossil's profile
 * of the picked files, read once over all of them (`tasks/profile.ts`) — before any model is asked;
 * and then the Tasks of docs/design/assistant.md, in order, on the page's model (`useModel`):
 * `model` once the files are read and *what is it about?* is answered — the relations and the
 * decisions; `requirements` once its decisions are taken — the question chips (`useTask`), and
 * whether each question kept is answerable; `mapping` once the person has asked all they wanted —
 * the program **Advanced** opens, and the preview and the build run. A Task that fails is in
 * `failures`, with its retry.
 *
 * A conversation kept is started again from its `seed`: the files picked, the person's choices and
 * the program last written — everything else is read and asked again, from the files.
 */

import { useEffect, useMemo, useRef, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- one listing per opened folder, the profile of the picked files and each Task's answer; each failure is shown in its place, beside the rest
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useTask } from "@kanzo-tech/ai";
import { type Proposal, runTask } from "@kanzo-tech/ai/task";
import type { Format, Profiled as Described } from "@fossil-lang/types";
import { inputs, profile } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/mosaic";
import type { FileReference } from "@/lib/assistant-conversation";
import type { StorageConnection } from "@/lib/connections";
import { ClientError } from "@/lib/errors";
import { host } from "@/lib/fossil/host";
import { childrenOf, connectionNode, type SourceFile, type SourceNode } from "../sources";
import { useSources } from "../use-sources";
import { useModel } from "@/lib/ai";
import { type AssistantData, type DecisionItem, optionOf, type Question, type QuestionOffer, type TaskFailure, type Thing } from "./model";
import { fossilCheck, mapping, mappingInput, programOf } from "./tasks/mapping";
import { accept, type Accepted, decisionsOf, defaultsOf, type Draft, modelTask, relationsOf } from "./tasks/model";
import { type Profiled, profiledOf } from "./tasks/profile";
import { isAnswerable, requirements } from "./tasks/requirements";
import { spoken, thingName } from "./tasks/words";

/** The rows the profile keeps of each file: enough for one row of each relation to be found across files. */
const SHOWN = 50;

/** No kept file resolved yet. */
const NONE_KEPT: ReadonlyMap<string, SourceFile | null> = new Map();

/** A file's id in the tree, `<connection>:<path>` (`childrenOf`'s), and the location it names. */
const fileId = ({ connection, path }: FileReference) => `${connection}:${path}`;
const locationOf = (id: string): FileReference => {
  const at = id.indexOf(":");
  return { connection: id.slice(0, at), path: id.slice(at + 1) };
};

/** The connections the assistant reads: the sink is written to, not read from. */
const readable = (c: StorageConnection) => c.kind === "data" && c.direction !== "sink";

/**
 * A kept file as the tree writes it (`childrenOf`, down the folders it is in), without listing them:
 * `null` when its connection is gone or no reader takes it.
 */
async function keptFile(
  file: FileReference,
  connections: readonly StorageConnection[],
  formats: readonly Format[],
  signal: AbortSignal,
): Promise<SourceFile | null> {
  const connection = connections.find((c) => c.name === file.connection && readable(c));
  if (!connection) return null;
  const listing = [{ path: file.path, size: 0 }];
  // One path listed: each level holds the one folder it goes down, or the file.
  for (let level: SourceNode[] = [connectionNode(connection)]; level[0]; ) {
    const node = level[0];
    if (node.kind === "file") return node;
    level = await childrenOf(node, listing, formats, { signal });
  }
  return null;
}

/** The picked file a source's reference names, by its id; the reference itself when none does. */
const fileOf = (picked: readonly SourceFile[], key: string) => picked.find((f) => f.line.includes(`"${key}"`))?.id ?? key;

/** One thing per file read, with its count and what it holds: what the profile says before any model. */
function thingsOf(profiled: Profiled, picked: readonly SourceFile[]): Thing[] {
  return profiled.sources.map((s) => ({
    id: fileOf(picked, s.key),
    name: thingName(s.file),
    count: s.rows,
    holds: s.columns.map((c) => c.name),
  }));
}

/**
 * The decisions a draft raises, each with the default the profile settles it with, if any, and the
 * person's pick over it.
 */
function decisionItems(draft: Draft, profiled: Profiled, chosen: Readonly<Record<string, string>>): DecisionItem[] {
  const defaults = defaultsOf(profiled);
  return decisionsOf(draft, profiled).map((decision) => ({
    decision,
    assumed: defaults[decision.id]?.assume ?? null,
    chosen: chosen[decision.id] ?? null,
  }));
}

/** A proposal's value, once its oracles held it; what they still said after the last attempt is the failure. */
function held<A>({ task, value, verdict }: Proposal<A>): A {
  if (!("diagnostics" in verdict)) return value;
  throw new ClientError("llm/failed", `The ${task} proposed did not hold.`, verdict.diagnostics.map((d) => d.message).join(" "));
}

const NO_MODEL: Accepted = { types: [], edges: [] };

/** The option the decision `id` stands at: the person's pick, else its default. */
function standing(items: readonly DecisionItem[], id: string): string | null {
  const item = items.find((d) => d.decision.id === id);
  return item ? optionOf(item) : null;
}

/** Where a kept conversation stood: what the hook starts from instead of nothing. */
export interface Seed {
  files: readonly FileReference[];
  /** The person's choices, by decision. */
  chosen: Readonly<Record<string, string>>;
  /** The program last written, run until the mapping writes it again. */
  program: string | null;
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
  /** The picked files as locations: what the conversation keeps of them. */
  files: FileReference[];
  /**
   * The program the mapping wrote — the last one while it writes the next — or `null` until there
   * is one: what the preview runs and the build builds.
   */
  mapped: string | null;
  /** The mapping is writing the program again: a decision changed. */
  writing: boolean;
  /** What fossil's profile answered of the picked files, as a run takes it. */
  described: Described | null;
}

export function useAssistant({
  connections,
  formats,
  about,
  asked,
  questions,
  seed,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
  /** *What is it about?*: `undefined` until answered, `""` when skipped. */
  about: string | undefined;
  /** The person has asked all they wanted. */
  asked: boolean;
  /** The questions the person kept, whose `answerable` this answers. */
  questions: readonly Question[];
  /** A kept conversation to start from. */
  seed?: Seed;
}): Assistant {
  // The sink is written to, not read from.
  const sources = useSources(connections.filter(readable), formats);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(seed?.files.map(fileId)));
  const [chosen, setChosen] = useState<Record<string, string>>(() => ({ ...seed?.chosen }));
  // The kept files, read without opening the folders they are in; and the kept program.
  const [kept] = useState(() => seed?.files ?? []);
  // Each kept file's line names it by fossil's binding, which waits for fossil's module.
  const keptRead = useQuery({
    queryKey: ["assistant", "kept", kept, connections, formats],
    queryFn: async ({ signal }) =>
      new Map(await Promise.all(kept.map(async (f) => [fileId(f), await keptFile(f, connections, formats, signal)] as const))),
    staleTime: Infinity,
    retry: false,
  });
  const keptFiles = keptRead.data ?? NONE_KEPT;
  const [keptProgram] = useState(() => seed?.program ?? null);

  const picked = [...selected].flatMap((id) => {
    const node = sources.collection.findNode(id);
    if (node?.kind === "file") return [node];
    return keptFiles.get(id) ?? [];
  });
  // A kept file no connection reads any more is said, never dropped.
  const unreachable = [...selected].filter((id) => keptFiles.get(id) === null && sources.collection.findNode(id) === undefined);
  const lines = picked.map((f) => f.line).sort();
  // The files are read together, once: the inclusions between two of them are part of the answer.
  const read = useQuery({
    queryKey: ["assistant", "profile", lines],
    queryFn: async ({ signal }) => {
      const sources = await inputs(lines.join("\n"), { host, signal });
      const described = await profile(sources, {
        host,
        engine: await engine({ signal }),
        options: { shown: SHOWN },
        signal,
      });
      return { profiled: profiledOf(described.profile, sources), undescribed: described.undescribed, described };
    },
    enabled: picked.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  const profiled = read.data?.profiled ?? null;
  const problems: { id: string; problem: unknown }[] = [
    ...unreachable.map((id) => ({
      id,
      problem: new ClientError("web/unknown", "A file this conversation read cannot be read", `${id} is not on a connection this workspace reads.`),
    })),
    ...(keptRead.error ? [{ id: "kept", problem: keptRead.error }] : []),
    ...(read.error
      ? [{ id: "profile", problem: read.error }]
      : (read.data?.undescribed ?? []).map(({ source, problem }) => ({ id: fileOf(picked, source.key), problem }))),
  ];

  const model = useModel();

  // ── model: the types, once the files are read and what it is about is said ──
  const drafted = useQuery({
    queryKey: ["assistant", "model", lines, about],
    queryFn: async ({ signal }) => {
      return held(await runTask(modelTask(profiled!), { profiled: profiled!, about: about ?? "" }, { model, signal }));
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
        return programOf(input, held(await runTask(mapping, input, { model, signal })));
      } finally {
        check.close();
      }
    },
    enabled: accepted !== null && asked,
    retry: false,
    staleTime: Infinity,
    // A decision changed is a program written again: the last one stays the preview's meanwhile.
    placeholderData: keepPreviousData,
  });

  const failures: TaskFailure[] = [
    ...(drafted.isError ? [{ task: "model" as const, problem: drafted.error, retry: () => void drafted.refetch() }] : []),
    ...(offered.state === "failed" ? [{ task: "requirements" as const, problem: offered.error, retry: () => offered.propose() }] : []),
    ...(mapped.isError ? [{ task: "mapping" as const, problem: mapped.error, retry: () => void mapped.refetch() }] : []),
  ];

  return {
    sources,
    selected,
    reading: picked.length > 0 && read.isPending ? { done: 0, total: picked.length } : null,
    problems,
    understanding: { things: profiled ? thingsOf(profiled, picked) : [], relations },
    offers,
    decisions,
    failures,
    questions: questions.map((q) => ({ ...q, answerable: answerable(q) })),
    expanded,
    setExpanded,
    setSelected,
    choose: (decision, option) => setChosen((prev) => ({ ...prev, [decision]: option })),
    // The mapping's program once it holds; until then the picked files' bindings.
    program: mapped.data ?? picked.map((f) => f.line).join("\n"),
    files: [...selected].map(locationOf),
    mapped: accepted === null ? null : (mapped.data ?? keptProgram),
    writing: mapped.isFetching,
    described: read.data?.described ?? null,
  };
}
