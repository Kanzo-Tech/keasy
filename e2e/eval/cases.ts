/**
 * **The evaluation set** — phase 0 of Kanzo Tasks (kanzo-ui's `/docs/design/tasks`, keasy's
 * `docs/design/assistant.md`). Written by hand and never trained on: a case is what a reader asks and
 * what the data says the answer is, so the same set scores today's agent, a Task, and every model
 * either is run with.
 *
 * Every figure is the example's own, computed with DuckDB over `infra/dev/examples/<name>/data` — the
 * query beside each, or the storyboard's (`e2e/demos/STORYBOARD.md`, **Numbers**) where it is cited.
 * A case is scored by **execution accuracy**: the rows the answer was read from (its card's data
 * table, the engine's) hold every `holds` pair and no `lacks` pair. A pair is a label and a count,
 * read as `holds()` in `demos/nobel-ask.demo.ts` reads one; a label of `null` is a figure, any cell.
 */

/** A row the answer must, or must not, have been read from: a label and its count. */
export type Pair = readonly [label: string | null, n: number];

/** The page the question is asked on: the Dashboard view's relation, and a bar picked on its one tile. */
export interface Page {
  /** `DiscoverPage.relation`'s root and hops. */
  readonly root: string;
  readonly hops?: readonly string[];
  /** The page's filter, if any: one tile counting `x`, and the bar `pick` picked on it. */
  readonly filter?: { readonly x: string; readonly pick: string };
}

export interface AskCase {
  readonly id: string;
  /** The dev example the graph is built from (`seedGraph`). */
  readonly example: string;
  readonly page: Page;
  /** The questions, asked in turn in one conversation; the last one is scored. */
  readonly ask: readonly string[];
  readonly holds: readonly Pair[];
  readonly lacks?: readonly Pair[];
  /** Why the case is in the set: the failure it is the test for. */
  readonly tests: string;
}

const PRIZES_BY_CATEGORY: Page = { root: "LaureateAward", hops: [">category>Category"] };
const PHYSICS: Page = { ...PRIZES_BY_CATEGORY, filter: { x: "Category.name", pick: "Physics" } };

export const ASK: readonly AskCase[] = [
  // nobel-ask's two questions (STORYBOARD.md §4).
  {
    id: "nobel-universities-in-view",
    example: "nobel",
    page: PHYSICS,
    ask: ["Which universities won the most prizes?"],
    // Physics prizes by institution; 43 is UC's in every category — an answer that dropped the filter.
    holds: [["University of California", 16], ["Princeton University", 10]],
    lacks: [["University of California", 43]],
    tests: "a hop the page's filter reaches, and the filter kept",
  },
  {
    id: "nobel-follow-up-germany",
    example: "nobel",
    page: PHYSICS,
    ask: ["Which universities won the most prizes?", "Which ones were won in Germany?"],
    // `… and i.country = 'germany'`: every German institution has 2 Physics prizes or fewer.
    holds: [["University of Heidelberg", 2]],
    lacks: [["University of California", 16], ["Princeton University", 10]],
    tests: "a follow-up is the previous answer with one more where",
  },
  {
    id: "nobel-prizes-by-category",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many prizes were awarded in each category?"],
    // select category, count(*) from awards group by 1
    holds: [["Physics", 230], ["Chemistry", 200], ["Peace", 143]],
    tests: "the relation on screen, no filter",
  },
  {
    id: "nobel-laureates-twice",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["Which laureates won more than one prize?"],
    // select l.name, count(*) from awards a join laureates l on l.id = a.laureate group by 1 having count(*) > 1
    holds: [["Marie Curie", 2], ["Linus Pauling", 2]],
    tests: "a hop from the relation on screen to another type, ranked",
  },
  {
    id: "nobel-women",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many laureates are women?"],
    // select count(*) from laureates where gender = 'female'
    holds: [[null, 67]],
    tests: "a figure over another type than the one on screen, with a where",
  },
  {
    id: "nobel-birth-countries",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["In which countries were the most laureates born?"],
    // select co.name, count(*) from laureates l join countries co on co.id = l.country group by 1
    holds: [["USA", 296], ["Germany", 84]],
    tests: "a two-type hop the screen does not show",
  },
  // flights-* (STORYBOARD.md, OpenFlights' Numbers).
  {
    id: "flights-airports-by-country",
    example: "openflights",
    page: { root: "Airport" },
    ask: ["Which countries have the most airports?"],
    holds: [["United States", 551], ["Canada", 206], ["China", 173]],
    tests: "a ranking over the relation on screen",
  },
  {
    id: "flights-spain",
    example: "openflights",
    page: { root: "Airport" },
    ask: ["How many airports are there in Spain?"],
    holds: [[null, 40]],
    tests: "a figure with a where on a category's value",
  },
  // snb-explore (STORYBOARD.md §1).
  {
    id: "snb-gender",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many people are women, and how many are men?"],
    holds: [["female", 778], ["male", 750]],
    tests: "a breakdown by a category on a large graph's smallest type",
  },
  {
    id: "snb-women-born-1985-1989",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many women were born between 1985 and 1989?"],
    holds: [[null, 391]],
    tests: "two conditions at once, one of them a date range",
  },
];

/**
 * The assistant's cases: one per dev example, the files a person would pick and what they would say
 * the data is about. The gold is the example's own `mapping.fossil` and `shapes.shex`, beside it; the
 * baseline scores what today's wizard writes against the checker, as the studio's badge reads it.
 * CORDIS is in the set and needs its seed: its data is fetched from the Web Archive.
 */
export interface AssistantCase {
  readonly example: string;
  /** The connection the example's data is under (`seeds.ts`), and the files picked from it. */
  readonly connection: string;
  readonly files: readonly string[];
  readonly domain: string;
  /** What a person asks of the graph — the competency questions the gold program answers. */
  readonly questions: readonly string[];
}

export const ASSISTANT: readonly AssistantCase[] = [
  {
    example: "nobel",
    connection: "Nobel laureates",
    files: ["laureates.json", "awards.json", "categories.json", "institutions.json", "affiliations.json", "countries.json"],
    domain: "Nobel prizes since 1901: who won them, in which category, and from which university",
    questions: [
      "Who has won more than one Nobel prize?",
      "Which universities have the most Physics prizes?",
      "In which country was each laureate born?",
    ],
  },
  {
    example: "openflights",
    connection: "OpenFlights",
    files: ["airports.csv", "routes.csv"],
    domain: "Airports of the world and the routes between them",
    questions: [
      "Which countries have the most airports?",
      "Which airports can be reached from a given airport?",
      "Which airports are connected by a direct route?",
    ],
  },
  {
    example: "snb",
    connection: "LDBC SNB",
    files: ["dynamic/person_0_0.csv", "dynamic/person_knows_person_0_0.csv", "static/place_0_0.csv"],
    domain: "A social network: people, who knows whom, and where they live",
    questions: ["Who does a person know?", "In which city does each person live?", "How many people are women?"],
  },
  {
    example: "cordis",
    connection: "CORDIS",
    files: ["projects.csv", "schemes.csv", "organisations.csv", "participations.csv"],
    domain: "EU Horizon research projects and the organisations taking part in them",
    questions: [
      "Which organisations take part in the most projects?",
      "Which projects does an organisation take part in?",
      "How much funding did each project receive?",
    ],
  },
];
