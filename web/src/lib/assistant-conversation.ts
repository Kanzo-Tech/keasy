"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- a failed read is the hook's `problem`, for the chat to say beside the turns it can draw
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { Decision } from "@kanzo-tech/ai/task";
import { $api, http, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";

/**
 * The assistant's conversation, kept as reference chat systems keep one — the AI SDK's `UIMessage[]`
 * per chat id, saved after each reply and handed back to `useChat({ id, messages })` — in keasy's
 * `conversations` table, and named by the graph built from it (`Graph.conversation`). What was
 * decided travels as data parts of those messages, so Discover lists the decisions and **Change**
 * opens the conversation at one of them.
 *
 * **Structure only, never the person's data** (docs/design/assistant.md, *the conversation is
 * kept*): the person's data never leaves the browser, and a saved conversation is no exception.
 * {@link toStored} is the one gate: every save goes through it, and so does every read.
 */

/** A file the person picked, by where it is — never what it holds. */
export interface FileReference {
  /** The connection it is read through. */
  connection: string;
  /** Its path under the connection. */
  path: string;
}

/** A decision as it stood in the conversation: the options offered, and the one taken. */
export interface DecisionPart {
  decision: Decision;
  /** The option taken: the person's, or the safe default; `null` while it waits on the person. */
  option: string | null;
  /** Taken without asking: a safe default, said as an assumption. */
  assumed: boolean;
}

/** A question the person kept, and whether the files can answer it. */
export interface QuestionPart {
  id: string;
  text: string;
  answerable: boolean | null;
}

/**
 * Every data part a stored message may carry, by name (`data-<name>`). Each holds structure: what
 * the turn was, what was offered in keasy's words, and what the person chose or typed.
 */
// A type, not an interface: the AI SDK's `UIDataTypes` is a record, which only a type alias meets.
export type StoredParts = {
  /** Which turn the message is (`pick`, `understood`, `decide`, …): its kind, nothing it showed. */
  turn: { kind: string };
  /** The files the person picked, as locations. */
  files: { files: FileReference[] };
  /** The person's *what is it about?* sentence; `""` when skipped. */
  about: { text: string };
  decision: DecisionPart;
  question: QuestionPart;
  /** The program the mapping wrote — prelude and mappings. */
  program: { program: string };
};

/** A message of the assistant's conversation, as it is kept. */
export type AssistantMessage = UIMessage<never, StoredParts>;

/** A decision as it was taken, the last word on it in the conversation. */
export interface TakenDecision {
  decision: Decision;
  option: string;
  assumed: boolean;
}

// ── The gate ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";

/**
 * Each kept data part, rebuilt from the fields it may hold and nothing else: a field added to a part
 * upstream — an example row, a count — does not ride along unread. `null` drops the part.
 */
const KEPT: { [K in keyof StoredParts]: (data: Json) => StoredParts[K] | null } = {
  turn: ({ kind }) => (str(kind) ? { kind } : null),
  files: ({ files }) =>
    Array.isArray(files)
      ? { files: files.flatMap((f) => (isObject(f) && str(f.connection) && str(f.path) ? [{ connection: f.connection, path: f.path }] : [])) }
      : null,
  about: ({ text }) => (str(text) ? { text } : null),
  decision: ({ decision, option, assumed }) => {
    if (!isObject(decision) || !str(decision.id) || !str(decision.question) || !Array.isArray(decision.options)) return null;
    // Our labels only: an option's `detail` may quote the data, so it is not kept.
    const options = decision.options.flatMap((o) => (isObject(o) && str(o.id) && str(o.label) ? [{ id: o.id, label: o.label }] : []));
    return {
      decision: { id: decision.id, question: decision.question, options },
      option: str(option) ? option : null,
      assumed: assumed === true,
    };
  },
  question: ({ id, text, answerable }) =>
    str(id) && str(text) ? { id, text, answerable: typeof answerable === "boolean" ? answerable : null } : null,
  program: ({ program }) => (str(program) ? { program } : null),
};

/** A part as it is kept, or `null` when it is not. */
function keptPart(role: string, part: unknown): AssistantMessage["parts"][number] | null {
  if (!isObject(part) || !str(part.type)) return null;
  // What the person typed is theirs to keep: their questions, their reply. What the assistant
  // said in prose may quote a row ("e.g. Marie Curie · Physics · 1903"), and is said again from
  // the profile on reopening.
  if (part.type === "text") return role === "user" && str(part.text) ? { type: "text", text: part.text } : null;
  if (!part.type.startsWith("data-")) return null;
  const name = part.type.slice("data-".length);
  const keep = Object.hasOwn(KEPT, name) ? (KEPT[name as keyof StoredParts] as (data: Json) => unknown) : undefined;
  if (!keep || !isObject(part.data)) return null;
  const data = keep(part.data);
  if (data === null) return null;
  return { type: `data-${name}`, ...(str(part.id) ? { id: part.id } : {}), data } as AssistantMessage["parts"][number];
}

/**
 * `messages` as keasy stores them: structure only. Kept — turn kinds and ids, the options offered
 * (our labels), the person's choices, their typed text, the files picked as locations, the program.
 * Stripped — everything else: the assistant's prose, tool calls and their answers, the profile's
 * sample rows, example values, counts and column statistics, a file's contents, and any data part
 * this list does not name. A message left with no part is kept, as the turn it was.
 */
export function toStored(messages: readonly unknown[]): AssistantMessage[] {
  return messages.flatMap((message) => {
    if (!isObject(message) || !str(message.id)) return [];
    const role = message.role;
    if (role !== "user" && role !== "assistant") return [];
    const parts = Array.isArray(message.parts) ? message.parts.flatMap((p) => keptPart(role, p) ?? []) : [];
    return [{ id: message.id, role, parts }];
  });
}

/** The decisions of a conversation as they stand: the last word on each, taken; one still waiting is not. */
export function decisionsOf(messages: readonly AssistantMessage[]): TakenDecision[] {
  const last = new Map<string, DecisionPart>();
  for (const message of messages)
    for (const part of message.parts) if (part.type === "data-decision") last.set(part.data.decision.id, part.data);
  return [...last.values()].flatMap(({ decision, option, assumed }) => (option === null ? [] : [{ decision, option, assumed }]));
}

/** What an option is called: its label, or its id when the decision no longer lists it. */
export function labelOf({ decision, option }: TakenDecision): string {
  return decision.options.find((o) => o.id === option)?.label ?? option;
}

/** The assistant opened on conversation `conversation`, to take decision `decision` again. */
export const changeHref = (conversation: string, decision: string) =>
  `/graphs/new/assistant?conversation=${encodeURIComponent(conversation)}&decision=${encodeURIComponent(decision)}`;

// ── The hook ────────────────────────────────────────────────────────────────

/** The conversation's read, under the API's own key. */
export const conversationQuery = (id: string) => $api.queryOptions("get", "/v1/conversations/{id}", { params: { path: { id } } });

export interface AssistantConversation {
  /** The conversation's id: `null` until the first save of a new one. */
  id: string | null;
  /** Its messages as stored — `[]` for a new one — or `undefined` while they are read. */
  messages: AssistantMessage[] | undefined;
  /** Why it could not be read. */
  problem: unknown;
  /**
   * A graph was built from it: it is that graph's record, so the next save starts a new
   * conversation from these messages rather than change it.
   */
  built: boolean;
  /**
   * Save every message, after each reply: through {@link toStored}, replacing what was stored.
   * The first save of a new conversation creates it; a conversation a graph was built from is that
   * graph's record and is not saved over — the save starts a new one from these messages, and `id`
   * becomes its. Resolves with the id saved under.
   */
  save(messages: readonly UIMessage[]): Promise<string>;
  /** The decisions as they stand in the stored messages. */
  decisions: TakenDecision[];
}

/**
 * The assistant's conversation `id`, or a new one: what the chat resumes from and saves to. Saves
 * are made one at a time, in order, so a reply's save never lands under the one after it.
 */
export function useAssistantConversation(id?: string | null): AssistantConversation {
  const [saved, setSaved] = useState<string | null>(null);
  const current = saved ?? id ?? null;
  const read = useQuery({
    ...conversationQuery(current ?? ""),
    enabled: current !== null,
    staleTime: Infinity,
  });
  // Where the next save goes: the conversation as read, until a save answers where it went.
  const resumed = useRef({ id: current, built: false });
  const afterSave = useRef<{ id: string; built: boolean } | null>(null);
  const built = read.data?.built ?? false;
  useEffect(() => {
    resumed.current = { id: current, built };
  }, [current, built]);

  // One save at a time, in the order they were made: a mutation scope is TanStack's queue.
  const { mutateAsync: save } = useMutation({
    scope: { id: `conversation ${useId()}` },
    mutationFn: async (messages: readonly UIMessage[]) => {
      const body = { messages: toStored(messages) as unknown as Schemas["SaveMessagesRequest"]["messages"] };
      const { id: at, built } = afterSave.current ?? resumed.current;
      let conversation: Schemas["Conversation"];
      if (at === null || built) {
        conversation = (await http.POST("/v1/conversations", { body })).data!;
      } else {
        try {
          conversation = (await http.PUT("/v1/conversations/{id}/messages", { params: { path: { id: at } }, body })).data!;
        } catch (error) {
          // Built from meanwhile, in another tab: carry on in a new one.
          if ((error as { code?: unknown }).code !== "conversation/built") throw error;
          conversation = (await http.POST("/v1/conversations", { body })).data!;
        }
      }
      afterSave.current = { id: conversation.id, built: conversation.built };
      queryClient.setQueryData(conversationQuery(conversation.id).queryKey, conversation);
      setSaved(conversation.id);
      return conversation.id;
    },
  });

  const messages = useMemo(
    () => (current === null ? [] : read.data ? toStored(read.data.messages) : undefined),
    [current, read.data],
  );
  const decisions = useMemo(() => decisionsOf(messages ?? []), [messages]);
  return { id: current, messages, problem: read.error ?? undefined, built, save, decisions };
}
