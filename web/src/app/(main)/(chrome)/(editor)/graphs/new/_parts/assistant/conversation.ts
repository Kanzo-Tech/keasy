/**
 * The assistant's conversation as data: which turns are said, in order, from what the hook answers
 * (`AssistantData`) and what the person has replied. Nothing is drawn here and nothing is kept: the
 * transcript is derived again on every change, so a pick changed above re-reads everything below it.
 */

import { type AssistantData, type DecisionItem, optionOf, type Question, type ReadingProgress } from "./model";

/** What the person has replied, beyond the picks and choices the hook keeps. */
export interface Replies {
  /** The picked files were sent to be read. */
  picked: boolean;
  /** *What is it about?*: `undefined` until answered, `""` when skipped. */
  about: string | undefined;
  /** The person has asked all they wanted, and the graph may be built. */
  asked: boolean;
}

export const NO_REPLIES: Replies = { picked: false, about: undefined, asked: false };

/** One turn of the transcript: the assistant's (`said`) or the person's reply. */
export type Turn =
  | { kind: "pick" }
  | { kind: "picked"; files: number }
  | { kind: "reading"; reading: ReadingProgress | null }
  | { kind: "about" }
  | { kind: "about-reply"; text: string }
  | { kind: "understood" }
  | { kind: "decide"; item: DecisionItem; index: number; of: number }
  | { kind: "decided"; item: DecisionItem }
  | { kind: "assumed"; item: DecisionItem }
  | { kind: "ask" }
  | { kind: "asked"; question: Question }
  | { kind: "asked-all"; questions: number }
  | { kind: "build" };

/** What the conversation waits on: the reply the turn at its end asks for, `null` once it is over. */
export type Waiting = "pick" | "about" | "reading" | "decide" | "ask" | null;

export interface Conversation {
  turns: Turn[];
  waiting: Waiting;
}

/** A decision with no safe default: asked as a turn of its own, never assumed. */
const isOpen = (item: DecisionItem) => item.assumed === null;

/** The transcript so far, and the reply it waits on. */
export function converse(
  data: Pick<AssistantData, "selected" | "reading" | "decisions"> & { questions: readonly Question[] },
  replies: Replies,
): Conversation {
  const turns: Turn[] = [{ kind: "pick" }];
  const stop = (waiting: Waiting): Conversation => ({ turns, waiting });

  if (!replies.picked) return stop("pick");
  turns.push({ kind: "picked", files: data.selected.size }, { kind: "reading", reading: data.reading }, { kind: "about" });
  if (replies.about === undefined) return stop("about");
  turns.push({ kind: "about-reply", text: replies.about });
  if (data.reading !== null) return stop("reading");

  turns.push({ kind: "understood" });
  const decisions = data.decisions ?? [];
  const open = decisions.filter(isOpen);
  for (const [index, item] of open.entries()) {
    turns.push({ kind: "decide", item, index, of: open.length });
    if (item.chosen === null) return stop("decide");
    turns.push({ kind: "decided", item });
  }
  for (const item of decisions.filter((d) => !isOpen(d))) turns.push({ kind: "assumed", item });

  turns.push({ kind: "ask" }, ...data.questions.map((question) => ({ kind: "asked" as const, question })));
  if (!replies.asked) return stop("ask");
  turns.push({ kind: "asked-all", questions: data.questions.length }, { kind: "build" });
  return stop(null);
}

/** Why the reply cannot be given yet, in the person's words: what the turn above waits for. */
export function waitingFor(waiting: Waiting, picked: number): string | null {
  switch (waiting) {
    case "pick":
      return picked === 0 ? "Pick at least one file" : null;
    case "reading":
      return "Wait for the files to be read";
    case "decide":
      return "Choose an option above to continue";
    default:
      return null;
  }
}

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "one file", "6 files": a count with its noun, the noun plural unless there is one. */
export function counted(n: number, noun: string, plural = `${noun}s`): string {
  return `${n === 1 ? "one" : n} ${n === 1 ? noun : plural}`;
}

/** "two things to decide": the count in words while it is small, as a sentence says it. */
export function inWords(n: number, noun: string, plural = `${noun}s`): string {
  return `${NUMBERS[n] ?? n} ${n === 1 ? noun : plural}`;
}

const list = new Intl.ListFormat("en-GB", { type: "conjunction" });

/**
 * What each one of a thing holds, from its columns: "name, gender, birth date and 4 more". Column
 * names are the data's own words, so they are made readable (`birth_date` → "birth date") and not
 * renamed.
 */
export function holdsLine(holds: readonly string[], shown = 4): string | null {
  if (holds.length === 0) return null;
  const words = holds.map((h) => h.replace(/[_-]+/g, " ").trim());
  if (words.length <= shown + 1) return list.format(words);
  return `${words.slice(0, shown).join(", ")} and ${words.length - shown} more`;
}

/** The label of the option a decision stands at. */
export function takenLabel(item: DecisionItem): string | undefined {
  return item.decision.options.find((o) => o.id === optionOf(item))?.label;
}
