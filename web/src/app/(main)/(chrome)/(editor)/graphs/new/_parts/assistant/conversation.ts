/**
 * The assistant's conversation as data: which turns are said, in order, from what the hook answers
 * (`AssistantData`) and what the person has replied. Nothing is drawn here: the transcript is derived
 * again on every change, so a pick changed above re-reads everything below it. What is kept of it is
 * its structure (`messagesOf`), and a conversation kept is opened again from that (`restore`) — the
 * counts, rows and sentences are the profile's to say again (docs/design/assistant.md, *the
 * conversation is kept*).
 */

import type { AssistantMessage, FileReference, StoredParts } from "@/lib/assistant-conversation";
import { type AssistantData, type BuildProgress, type DecisionItem, optionOf, type Question } from "./model";

/** What the person has replied, beyond the picks and choices the hook keeps. */
export interface Replies {
  /**
   * The first message — the picked files and *what is it about?* sent together: `undefined` until
   * sent, `""` when nothing was said about them.
   */
  about: string | undefined;
  /** The person has asked all they wanted, and the graph may be built. */
  asked: boolean;
  /** The person asked for the graph: *Build the graph* is their message. */
  built: boolean;
}

export const NO_REPLIES: Replies = { about: undefined, asked: false, built: false };

/** Which of the work a list of steps is: reading and proposing, writing and running, or building. */
export type StepsGroup = "read" | "run" | "build";

/** The files a connection contributed to the first message, as its chip counts them. */
export interface SentSource {
  connection: string;
  files: number;
}

/** One turn of the transcript: the assistant's (`said`) or the person's reply. */
export type Turn =
  | { kind: "sent"; sources: SentSource[]; about: string }
  | { kind: "steps"; group: StepsGroup }
  | { kind: "understood" }
  | { kind: "decide"; item: DecisionItem; index: number; of: number }
  | { kind: "decided"; item: DecisionItem }
  | { kind: "assumed"; item: DecisionItem }
  | { kind: "ask" }
  | { kind: "asked"; question: Question }
  | { kind: "asked-all"; questions: number }
  | { kind: "preview" }
  | { kind: "build" }
  | { kind: "build-reply" };

/** What the conversation waits on: the reply the turn at its end asks for, `null` once it is over. */
export type Waiting = "send" | "reading" | "decide" | "ask" | null;

export interface Conversation {
  turns: Turn[];
  waiting: Waiting;
  /** The graph was built from it: it stays as it was built, and the composer gives way. */
  closed: boolean;
}

/** A decision with no safe default: asked as a turn of its own, never assumed. */
const isOpen = (item: DecisionItem) => item.assumed === null;

/** The files picked, counted by the connection they are read through (an id is `<connection>:<path>`). */
function sourcesOf(selected: ReadonlySet<string>): SentSource[] {
  const counts = new Map<string, number>();
  for (const id of selected) {
    const connection = id.slice(0, id.indexOf(":"));
    counts.set(connection, (counts.get(connection) ?? 0) + 1);
  }
  return [...counts].map(([connection, files]) => ({ connection, files }));
}

/**
 * What the graph built from these files is called: the connections they are read through, as the
 * person named them — *Nobel laureates*. The conversation's own name for its graph, until the person
 * renames it.
 */
export function graphName(files: readonly FileReference[]): string {
  const names = [...new Set(files.map((f) => f.connection))];
  return names.length > 0 ? names.join(", ") : "New graph";
}

/** The transcript so far, and the reply it waits on. */
export function converse(
  data: Pick<AssistantData, "selected" | "reading" | "decisions"> & {
    questions: readonly Question[];
    /** The build's progress, when one has been asked for in this tab. */
    build?: BuildProgress | null;
  },
  replies: Replies,
): Conversation {
  const turns: Turn[] = [];
  const stop = (waiting: Waiting, closed = false): Conversation => ({ turns, waiting, closed });

  if (replies.about === undefined) return stop("send");
  turns.push({ kind: "sent", sources: sourcesOf(data.selected), about: replies.about }, { kind: "steps", group: "read" });
  if (data.reading !== null) return stop("reading");

  turns.push({ kind: "understood" });
  const decisions = data.decisions ?? [];
  // A default taken is said under what was understood, as a line: it blocks nothing.
  for (const item of decisions.filter((d) => !isOpen(d))) turns.push({ kind: "assumed", item });
  const open = decisions.filter(isOpen);
  for (const [index, item] of open.entries()) {
    turns.push({ kind: "decide", item, index, of: open.length });
    if (item.chosen === null) return stop("decide");
    turns.push({ kind: "decided", item });
  }

  turns.push({ kind: "ask" }, ...data.questions.map((question) => ({ kind: "asked" as const, question })));
  if (!replies.asked) return stop("ask");
  turns.push({ kind: "asked-all", questions: data.questions.length }, { kind: "steps", group: "run" }, { kind: "preview" });
  if (!replies.built && !data.build) {
    turns.push({ kind: "build" });
    return stop(null);
  }
  turns.push({ kind: "build-reply" }, { kind: "steps", group: "build" }, { kind: "build" });
  return stop(null, data.build?.state === "done");
}

/** Why the reply cannot be given yet, in the person's words: what the composer says in its place. */
export function waitingFor(waiting: Waiting): string | null {
  switch (waiting) {
    case "reading":
      return "Reading your files…";
    case "decide":
      return "Answer above, or ask your own question…";
    default:
      return null;
  }
}

/** The label of the option a decision stands at. */
export function takenLabel(item: DecisionItem): string | undefined {
  return item.decision.options.find((o) => o.id === optionOf(item))?.label;
}

// ── What is kept of it ──────────────────────────────────────────────────────

type Part = AssistantMessage["parts"][number];
const data = <K extends keyof StoredParts>(name: K, value: StoredParts[K]) => ({ type: `data-${name}`, data: value }) as Part;

/** The person's turns; every other kind is the assistant's. */
const PERSON = new Set<Turn["kind"]>(["sent", "decided", "asked", "asked-all", "build-reply"]);

/** A decision as it stands at `item`: the option taken, and whether it was taken without asking. */
const decisionPart = (item: DecisionItem, option: string | null) =>
  data("decision", { decision: item.decision, option, assumed: item.chosen === null && option !== null });

/** The id of a turn's message: its kind, and what it is about where a kind is said more than once. */
function messageId(turn: Turn): string {
  switch (turn.kind) {
    case "decide":
    case "decided":
    case "assumed":
      return `${turn.kind}:${turn.item.decision.id}`;
    case "asked":
      return `asked:${turn.question.id}`;
    default:
      return turn.kind;
  }
}

/** What a turn keeps beside its kind: what the person picked, chose or typed, and the program. */
function partsOf(turn: Turn, { files, program }: { files: readonly FileReference[]; program: string | null }): Part[] {
  switch (turn.kind) {
    case "sent":
      // One message: the files and what they are about, together.
      return [data("files", { files: files.map(({ connection, path }) => ({ connection, path })) }), data("about", { text: turn.about })];
    case "decide":
      // Asked, not yet answered: `option: null` until the person's reply, the turn after it.
      return [decisionPart(turn.item, null)];
    case "decided":
    case "assumed":
      return [decisionPart(turn.item, optionOf(turn.item))];
    case "asked": {
      const { id, text, answerable } = turn.question;
      return [data("question", { id, text, answerable })];
    }
    case "preview":
      return program === null ? [] : [data("program", { program })];
    default:
      return [];
  }
}

/**
 * The transcript as it is kept: a message per turn, each with its kind and what the person picked,
 * chose or typed — the files as locations, the decisions with the option taken, the questions, the
 * program. Nothing the turns show of the data: no count, no row, no sentence.
 */
export function messagesOf(
  turns: readonly Turn[],
  kept: { files: readonly FileReference[]; program: string | null },
): AssistantMessage[] {
  // Steps are drawn from the state at hand and said again, so they are not kept.
  return turns.filter((turn) => turn.kind !== "steps").map((turn) => ({
    id: messageId(turn),
    role: PERSON.has(turn.kind) ? "user" : "assistant",
    parts: [data("turn", { kind: turn.kind }), ...partsOf(turn, kept)],
  }));
}

/** A kept conversation, as the chat starts from it again. */
export interface Restored {
  replies: Replies;
  files: FileReference[];
  /** The options the person chose, by decision: what the hook raises the decisions with again. */
  chosen: Record<string, string>;
  questions: Question[];
  /** The program last written, which the preview runs until the mapping writes it again. */
  program: string | null;
}

/**
 * Where a kept conversation stood: the files picked, what it is about, the person's choices (an
 * assumption stays the default's to make again), the questions kept, whether they had asked all they
 * wanted, and the program. The last word on each wins, as the conversation said it.
 */
export function restore(messages: readonly AssistantMessage[]): Restored {
  const kinds = new Set<string>();
  let files: FileReference[] = [];
  let about: string | undefined;
  let program: string | null = null;
  const chosen: Record<string, string> = {};
  const questions = new Map<string, Question>();
  for (const message of messages)
    for (const part of message.parts)
      switch (part.type) {
        case "data-turn":
          kinds.add(part.data.kind);
          break;
        case "data-files":
          files = part.data.files;
          break;
        case "data-about":
          about = part.data.text;
          break;
        case "data-decision": {
          const { decision, option, assumed } = part.data;
          if (option !== null && !assumed) chosen[decision.id] = option;
          else delete chosen[decision.id];
          break;
        }
        case "data-question":
          questions.set(part.data.id, { ...part.data });
          break;
        case "data-program":
          program = part.data.program;
          break;
      }
  const sent = files.length > 0 && kinds.has("sent");
  // Asking for the graph is not restored: a conversation reopened is not mid-build.
  return {
    replies: { about: sent ? (about ?? "") : undefined, asked: sent && kinds.has("asked-all"), built: false },
    files,
    chosen,
    questions: [...questions.values()],
    program,
  };
}
