/**
 * What the assistant's conversation reads — and nothing it computes. Each turn is drawn from these
 * shapes alone (`conversation.ts` orders them); `use-assistant.ts` is the one place that fills them,
 * from the connection listings, fossil's profile of the picked files, and the `model`, `mapping` and
 * `requirements` Tasks (`tasks/`, docs/design/assistant.md). A field a Task fills is `null` until it
 * has: `null` is "not known yet", never "none", so a turn leaves that part out rather than say there
 * is nothing.
 *
 * None of these carry a shape, an IRI, a predicate or a cardinality: the person reads things, counts,
 * sentences and rows.
 */

import type { Decision } from "@kanzo-tech/ai/task";
import type { StorageConnection } from "@/lib/connections";
import type { SourceBranch, SourceNode } from "../sources";

// ── The data ────────────────────────────────────────────────────────────────

/** How far reading the picked files has got: "Reading the files… 4 of 6". */
export interface ReadingProgress {
  done: number;
  total: number;
}

/** A question on offer for "What would you like to know?" — a `requirements` proposal, as a chip. */
export interface QuestionOffer {
  id: string;
  text: string;
  /** Why it is on offer: what in the files answers it. */
  rationale?: string;
}

/** A question the person kept, written or taken from an offer. */
export interface Question {
  id: string;
  text: string;
  /** Whether these files can answer it: `null` until an oracle has said. */
  answerable: boolean | null;
}

// ── What is in it ───────────────────────────────────────────────────────────

/** A thing in the data: laureates, prizes, airports. */
export interface Thing {
  id: string;
  name: string;
  /** How many there are: `null` until counted. */
  count: number | null;
  /** What each one holds, in the data's own words (its columns), when that is all that is known. */
  holds: readonly string[];
}

/** How things hang together, as a sentence and one real row: "Each award has a laureate…". */
export interface Relation {
  id: string;
  sentence: string;
  /** One real example, a value per part of the sentence: Marie Curie · Physics · 1903. */
  example: readonly string[] | null;
}

/**
 * A question the data raised, as options and never free text — kanzo-ui's `Decision`, MCP's
 * elicitation. One with `assumed` had a safe default: it is taken and shown as an assumption, and
 * blocks nothing. One without blocks until it is chosen.
 */
export interface DecisionItem {
  decision: Decision;
  /** The option taken without asking, when there was a safe default. */
  assumed: string | null;
  /** The option the person picked, which wins over `assumed`. */
  chosen: string | null;
}

/** What the assistant understood of the picked files. */
export interface Understanding {
  things: readonly Thing[];
  /** `null` until the `model` Task proposes them. */
  relations: readonly Relation[] | null;
}

// ── The graph ───────────────────────────────────────────────────────────────

/** Where the whole graph is, once the person asks for it (`lib/fossil/build.ts`). */
export type { BuildProgress } from "@/lib/fossil/build";

/** Everything the conversation reads, as `use-assistant.ts` answers it. */
export interface AssistantData {
  /** Every connection the assistant may read: a pill each, over the files it lists. */
  connections: readonly StorageConnection[];
  /** What a connection or a folder under it holds, listed once and kept. */
  list: (node: SourceBranch) => Promise<SourceNode[]>;
  /** The ids of the picked files. */
  selected: ReadonlySet<string>;
  /** `null` when nothing is being read. */
  reading: ReadingProgress | null;
  /** What could not be read, each with its problem: shown, never dropped. */
  problems: readonly { id: string; problem: unknown }[];
  understanding: Understanding;
  /** `null` until the `requirements` Task offers them. */
  offers: readonly QuestionOffer[] | null;
  /** `null` until the `model` and `mapping` Tasks raise them. */
  decisions: readonly DecisionItem[] | null;
  /** Each Task that failed, with what stopped it and the way to ask again: said, never swallowed. */
  failures: readonly TaskFailure[];
}

/** A Task that threw, or whose oracles still refused after its attempts. */
export interface TaskFailure {
  task: "model" | "mapping" | "requirements";
  problem: unknown;
  retry: () => void;
}

/** The option a decision stands at: the person's, else the default taken. */
export const optionOf = (item: DecisionItem): string | null => item.chosen ?? item.assumed;

/** A decision that stops the flow: no safe default, and nobody has chosen. */
export const blocks = (item: DecisionItem): boolean => optionOf(item) === null;
