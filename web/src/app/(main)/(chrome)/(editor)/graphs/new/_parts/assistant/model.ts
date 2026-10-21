/**
 * What the assistant's conversation reads — and nothing it computes. Each turn is drawn from these
 * shapes alone (`conversation.ts` orders them); `use-assistant.ts` is the one place that fills them,
 * from the connection listings, fossil's profile of the picked files, and the model, mapping and
 * requirements written from it (`tasks/`, docs/design/assistant.md). A field a step fills is `null`
 * until it has: `null` is "not known yet", never "none", so a turn leaves that part out rather than say there
 * is nothing.
 *
 * None of these carry a shape, an IRI, a predicate or a cardinality: the person reads things, counts,
 * sentences and rows.
 */

import type { AskSpec } from "@kanzo-tech/ai/data";
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
  /** Ask's spec, held by Ask's oracles before it is offered: what the preview asks, with no model. */
  spec: AskSpec;
  /** Why it is on offer: what in the files answers it. */
  rationale?: string;
}

/** A question the person kept, written or taken from an offer. */
export interface Question {
  id: string;
  text: string;
  /** Whether these files can answer it: `null` until the preview's Ask has answered it. */
  answerable: boolean | null;
  /** The spec it is asked as, with no model: a chip's, or the one Ask wrote when it answered it. */
  spec?: AskSpec;
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
 * elicitation. One with `assumed` had a safe default: it is taken and shown as an assumption. One
 * without is asked, and blocks nothing either: the graph and the preview use its first option until
 * it is chosen, and only the build waits on it.
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
  /** The ids of the picked files that are vocabularies: drawn apart from the data, and not profiled. */
  vocabularies: ReadonlySet<string>;
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

/** A step that threw: fossil declaring the model, or the program not compiling. */
export interface TaskFailure {
  task: "mapping";
  problem: unknown;
  retry: () => void;
}

/** The option a decision stands at: the person's, else the default taken. */
export const optionOf = (item: DecisionItem): string | null => item.chosen ?? item.assumed;

/** A decision the build waits on: no safe default, and nobody has chosen. */
export const blocks = (item: DecisionItem): boolean => optionOf(item) === null;
