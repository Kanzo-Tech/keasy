"use client";

/**
 * The one adaptor between what keasy can read and what the assistant's turns draw (`model.ts`).
 * The turns compute nothing; everything they show is answered here.
 *
 * What it answers, from real data: the tree, from the connections' listings (`useSources`, the
 * studio's); once the first message is sent, one thing per file with its count and columns, from
 * fossil's profile of the picked files, read once over all of them (`tasks/profile.ts`); and then the
 * steps of docs/design/assistant.md, in order, none of them a model's: the model fossil infers
 * from the profile — the relations, and its ambiguities said as decisions; then, over that model with
 * each open ambiguity at its first option meanwhile, the question chips, and the program fossil
 * writes and checks — which **Open in the editor** opens, and the preview and the build run. No model is asked here: a
 * question is the preview's Ask's to answer. A step that fails is in `failures`, with its retry.
 *
 * A conversation kept is started again from its `seed`: the files picked, the person's choices and
 * the program last written — everything else is read and asked again, from the files.
 */

import { useCallback, useMemo, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- one listing per opened folder, the profile of the picked files and each Task's answer; each failure is shown in its place, beside the rest
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Format, Profiled as Described } from "@fossil-lang/types";
import { infer, profile } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/mosaic/engine";
import type { FileReference } from "@/lib/assistant-conversation";
import type { StorageConnection } from "@/lib/connections";
import { ClientError } from "@/lib/errors";
import { host } from "@/lib/fossil/host";
import { childrenOf, connectionNode, type SourceBranch, type SourceFile, type SourceNode } from "../sources";
import { listChildren } from "../use-sources";
import { type AssistantData, type DecisionItem, type QuestionOffer, type TaskFailure, type Thing } from "./model";
import { fossilCheck, mappingOf, writeProgram } from "./tasks/mapping";
import { assumedOf, decisionsOf, relationsOf } from "./tasks/model";
import { type Profiled, profiledOf, thingName } from "./tasks/profile";
import { joinGraphOf, offersOf } from "./tasks/requirements";

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
const readable = (c: StorageConnection) => c.direction !== "sink";

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
const fileOf = (picked: readonly SourceFile[], key: string) => picked.find((f) => f.reference === key)?.id ?? key;

/** One thing per file read, with its count and what it holds: what the profile says before any model. */
function thingsOf(profiled: Profiled, picked: readonly SourceFile[]): Thing[] {
  return profiled.sources.map((s) => ({
    id: fileOf(picked, s.key),
    name: thingName(s.file),
    count: s.rows,
    holds: s.columns.map((c) => c.name),
  }));
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
  /** Pick `files`, or drop them: what a pill's menu does. */
  pick: (files: readonly SourceFile[], on: boolean) => void;
  /** Drops picked files by id: a card's cross. */
  drop: (ids: readonly string[]) => void;
  /** The person's pick of a decision's option. */
  choose: (decision: string, option: string) => void;
  /** The picked files as the program's binding lines: what Open in the editor opens the editor with. */
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
  seed,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
  /** *What is it about?*: `undefined` until answered, `""` when skipped. */
  about: string | undefined;
  /** A kept conversation to start from. */
  seed?: Seed;
}): Assistant {
  // The sink is written to, not read from.
  const readableConnections = useMemo(() => connections.filter(readable), [connections]);
  const list = useCallback((node: SourceBranch) => listChildren(node, formats), [formats]);
  // The files picked, by id: the file itself once a menu has listed it, `null` for a kept one, which
  // `keptFiles` resolves without listing the folders it is in.
  const [chosenFiles, setChosenFiles] = useState<ReadonlyMap<string, SourceFile | null>>(
    () => new Map(seed?.files.map((f) => [fileId(f), null] as const)),
  );
  const selected = useMemo(() => new Set(chosenFiles.keys()), [chosenFiles]);
  const pick = useCallback(
    (files: readonly SourceFile[], on: boolean) =>
      setChosenFiles((prev) => {
        const next = new Map(prev);
        for (const f of files) {
          if (on) next.set(f.id, f);
          else next.delete(f.id);
        }
        return next;
      }),
    [],
  );
  const drop = useCallback(
    (ids: readonly string[]) => setChosenFiles((prev) => new Map([...prev].filter(([id]) => !ids.includes(id)))),
    [],
  );
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

  const every = [...chosenFiles].flatMap(([id, file]) => file ?? keptFiles.get(id) ?? []);
  // A vocabulary is not data: it is not profiled, and the things are the data's.
  const picked = every.filter((f) => !f.vocabulary);
  const vocabularies = new Set(every.filter((f) => f.vocabulary).map((f) => f.id));
  // A kept file no connection reads any more is said, never dropped.
  const unreachable = [...chosenFiles].filter(([id, file]) => file === null && keptFiles.get(id) === null).map(([id]) => id);
  const sources = picked.map((f) => ({ reference: f.reference, format: f.reader })).sort((a, b) => a.reference.localeCompare(b.reference));
  // The files are read together, once: the inclusions between two of them are part of the answer.
  const read = useQuery({
    queryKey: ["assistant", "profile", sources],
    queryFn: async ({ signal }) => {
      const described = await profile(sources, { host, engine: await engine({ signal }), options: { shown: SHOWN }, signal });
      return { profiled: profiledOf(described.profile), undescribed: described.undescribed, described };
    },
    // Nothing is read until the first message is sent: picking files is not asking.
    enabled: picked.length > 0 && about !== undefined,
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

  // ── model: fossil's, from the profile, each ambiguity at the person's choice or its first option ──
  const describedProfile = read.data?.described.profile;
  const inferred = useQuery({
    queryKey: ["assistant", "model", describedProfile, chosen],
    queryFn: ({ signal }) => infer(describedProfile!, { choices: chosen, signal }),
    enabled: describedProfile !== undefined && profiled !== null && profiled.sources.length > 0,
    retry: false,
    staleTime: Infinity,
    // A choice is a model inferred again: the last one stays meanwhile.
    placeholderData: keepPreviousData,
  });
  const model = inferred.data?.model ?? null;
  const decisions = useMemo((): DecisionItem[] | null => {
    if (!inferred.data || !profiled) return null;
    const { ambiguities } = inferred.data;
    return decisionsOf(inferred.data, profiled).map((decision, i) => ({
      decision,
      assumed: assumedOf(ambiguities[i]!),
      chosen: chosen[decision.id] ?? null,
    }));
  }, [inferred.data, profiled, chosen]);
  const relations = useMemo(() => (model && profiled ? relationsOf(model, profiled) : null), [model, profiled]);
  const modelKey = model ? JSON.stringify(model) : null;

  // ── mapping: the program fossil writes of the model, and the graph its mapping describes ──
  const mapped = useQuery({
    queryKey: ["assistant", "mapping", modelKey],
    queryFn: async ({ signal }) => {
      const check = fossilCheck({ host, engine: await engine({ signal }) });
      try {
        return await writeProgram(model!, { base: window.location.origin, check, signal });
      } finally {
        check.close();
      }
    },
    enabled: model !== null,
    retry: false,
    staleTime: Infinity,
    // A decision changed is a program written again: the last one stays the preview's meanwhile.
    placeholderData: keepPreviousData,
  });
  const graphed = useQuery({
    queryKey: ["assistant", "graph", modelKey],
    queryFn: async ({ signal }) => joinGraphOf(model!, await mappingOf(mapped.data!, { host, signal })),
    enabled: model !== null && mapped.data !== undefined && !mapped.isPlaceholderData,
    retry: false,
    staleTime: Infinity,
  });
  const graph = model ? (graphed.data ?? null) : null;

  // ── requirements: questions to start from, once the model is accepted ──
  const offered = useQuery({
    queryKey: ["assistant", "offers", modelKey],
    queryFn: async () => (await offersOf(model!, graph!)).map((r, i): QuestionOffer => ({ id: `offer-${i}`, ...r })),
    enabled: graph !== null,
    retry: false,
    staleTime: Infinity,
  });
  const offers = model ? (offered.data ?? null) : null;

  const failures: TaskFailure[] = [
    ...(inferred.isError ? [{ task: "model" as const, problem: inferred.error, retry: () => void inferred.refetch() }] : []),
    // Writing the program and describing its graph are one step to the person: the first that failed says it.
    ...[mapped, graphed].filter((q) => q.isError).slice(0, 1).map((q) => ({ task: "mapping" as const, problem: q.error, retry: () => void q.refetch() })),
  ];

  return {
    connections: readableConnections,
    list,
    selected,
    vocabularies,
    reading: picked.length > 0 && about !== undefined && read.isPending ? { done: 0, total: picked.length } : null,
    problems,
    understanding: { things: profiled ? thingsOf(profiled, picked) : [], relations },
    offers,
    decisions,
    failures,
    pick,
    drop,
    choose: (decision, option) => setChosen((prev) => ({ ...prev, [decision]: option })),
    // The mapping's program once it holds; until then the picked files' bindings.
    program: mapped.data ?? every.map((f) => f.line).join("\n"),
    files: [...chosenFiles.keys()].map(locationOf),
    mapped: model === null ? null : (mapped.data ?? keptProgram),
    writing: mapped.isFetching,
    described: read.data?.described ?? null,
  };
}
