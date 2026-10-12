/**
 * **The evaluation set** — phase 1 of Kanzo Tasks (kanzo-ui's `/docs/design/tasks`, keasy's
 * `docs/design/assistant.md`). Written by hand and never trained on: a case is what a reader asks and
 * what the data says the answer is, so the same set scores today's agent, a Task, and every model
 * either is run with.
 *
 * Every figure is the example's own, computed with DuckDB over `infra/dev/examples/<name>/data` — the
 * query beside each, or the storyboard's (`e2e/demos/STORYBOARD.md`, **Numbers**) where it is cited.
 * Ask's cases are by shape of question, not by count: Nobel for nearly every shape, LDBC SNB for
 * what Nobel lacks — self-joins and a large graph. The set grows with readers' failures.
 *
 * A case is scored by **execution accuracy**: the rows the answer was read from (its card's data
 * table, the engine's) hold every `holds` pair and no `lacks` pair. A pair is a label and a count,
 * read as `holds()` in `demos/nobel-ask.demo.ts` reads one; a label of `null` is a figure, any cell.
 * Two shapes have no rows to score: a question two relations answer equally, which must be asked
 * back with the relations as numbered options (`expects: "question"`), and one the data cannot
 * answer, which must draw no card (`expects: "refusal"`).
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
  /** What the last question must end in: rows (the default), a question back, or no answer. */
  readonly expects?: "rows" | "question" | "refusal";
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
  {
    id: "nobel-prizes",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many Nobel prizes have been awarded?"],
    // select count(*) from awards
    holds: [[null, 1026]],
    tests: "a figure over the relation's root, no where",
  },
  {
    id: "nobel-women-by-category",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["In which categories have women won the most prizes?"],
    // … join laureates l … where l.gender = 'female' group by category
    holds: [["Peace", 20], ["Literature", 18], ["Physiology or Medicine", 14]],
    tests: "a breakdown over one hop with a where over another",
  },
  {
    id: "nobel-prizes-to-women",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many prizes went to women?"],
    // 68 prizes to 67 women: Marie Curie won two. 67 is the laureates, the wrong thing counted.
    holds: [[null, 68]],
    lacks: [[null, 67]],
    tests: "what is counted: prizes, not the laureates who won them",
  },
  {
    id: "nobel-2000s",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many prizes were awarded between 2000 and 2009?"],
    // select count(*) from awards where year between 2000 and 2009
    holds: [[null, 123]],
    tests: "a date range on a year",
  },
  {
    id: "nobel-since-2000-by-category",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["Since 2000, how many prizes has each category awarded?"],
    holds: [["Physics", 71], ["Chemistry", 68], ["Literature", 26]],
    tests: "an open-ended date range and a breakdown at once",
  },
  {
    id: "nobel-peace-1990s",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many Peace prizes were awarded in the 1990s?"],
    holds: [[null, 17]],
    tests: "a category and a decade, both written in words",
  },
  {
    id: "nobel-physics-by-gender",
    example: "nobel",
    page: PHYSICS,
    ask: ["How do these prizes split between men and women?"],
    // "these" is the page: the Physics prizes, 225 to men and 5 to women.
    holds: [["male", 225], ["female", 5]],
    tests: "a breakdown over a hop, under the page's filter, named only as «these»",
  },
  {
    id: "nobel-german-born-by-category",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["Laureates born in Germany: which categories did they win in?"],
    // awards ⋈ laureates ⋈ countries where country = 'Germany', by category: two hops apart
    holds: [["Physics", 27], ["Chemistry", 26], ["Physiology or Medicine", 18]],
    tests: "two hops from the counted type, one carrying the where and one the breakdown",
  },
  {
    id: "nobel-universities-by-country",
    example: "nobel",
    page: { root: "University" },
    ask: ["Which countries have the most universities?"],
    // select co.name, count(*) from institutions i join countries co … group by 1
    holds: [["USA", 147], ["Germany", 55], ["United Kingdom", 42]],
    tests: "a hop from a type that is not the one the page usually shows",
  },
  {
    id: "nobel-paris-universities",
    example: "nobel",
    page: { root: "University" },
    ask: ["How many of the universities are in Paris?"],
    holds: [[null, 15]],
    tests: "a where on a type's own field, a figure",
  },
  {
    id: "nobel-born-in-poland",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many laureates were born in Poland?"],
    // Within today's borders, as the API places a birth: Marie Curie and 27 others.
    holds: [[null, 28]],
    tests: "a where across a hop, counting the type at its start",
  },
  {
    id: "nobel-women-born-since-1950",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many women laureates were born in 1950 or later?"],
    holds: [[null, 23]],
    tests: "a category where and a date where on one type",
  },
  {
    id: "nobel-shared-physics",
    example: "nobel",
    page: PHYSICS,
    ask: ["How are these prizes shared — alone, in halves, thirds or quarters?"],
    // share is the denominator: 47 alone, 86 halves, 57 thirds, 40 quarters
    holds: [["1", 47], ["2", 86], ["4", 40]],
    tests: "a breakdown by a numeric field the reader names in words",
  },
  {
    id: "nobel-chemistry-universities",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["Which universities have the most Chemistry prizes?"],
    holds: [["University of California", 15], ["Harvard University", 6]],
    tests: "a ranking over a hop, with a where over another hop of the same root",
  },
  {
    id: "nobel-motivation-peace",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many prizes mention peace in their motivation?"],
    // motivation ilike '%peace%'
    holds: [[null, 61]],
    tests: "a contains over free text",
  },
  {
    id: "nobel-synonym-female-winners",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How many female Nobel winners are there?"],
    // "female winners" is gender = 'female' over the laureates
    holds: [[null, 67]],
    tests: "a synonym: «female winners» for laureates whose gender is female",
  },
  {
    id: "nobel-countries-tie",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["Which countries have won the most prizes?"],
    expects: "question",
    // A prize reaches a country two equally short ways: its laureate's birth (USA 299) and its
    // university's country (USA 411). Answering either without asking is guessing.
    holds: [],
    tests: "a tie the reader must decide, asked back with both relations",
  },
  {
    id: "nobel-no-prize-money",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["How much prize money was awarded in 2020?"],
    expects: "refusal",
    // The data has no amount at all: any card is an answer to a different question.
    holds: [],
    tests: "a question the data has no field for",
  },
  {
    id: "nobel-no-age",
    example: "nobel",
    page: PRIZES_BY_CATEGORY,
    ask: ["What was the average age of laureates when they won?"],
    expects: "refusal",
    // An age is an expression over two fields of two types; the spec has no arithmetic.
    holds: [],
    tests: "a question the spec cannot say: arithmetic across two types",
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
  {
    id: "snb-browsers",
    example: "snb",
    page: { root: "Person" },
    ask: ["Which browsers do people use most?"],
    holds: [["Firefox", 628], ["Chrome", 438], ["Internet Explorer", 364]],
    tests: "a ranking by a category on the type on screen",
  },
  {
    id: "snb-countries",
    example: "snb",
    page: { root: "Person" },
    ask: ["Which countries do most people live in?"],
    // A person is located in a city, and a city is part of a country: Place twice, a self-join.
    holds: [["India", 222], ["China", 208], ["Germany", 55]],
    tests: "a self-join: the same type twice on one path",
  },
  {
    id: "snb-posts-by-women",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many posts were written by women?"],
    holds: [[null, 68294]],
    tests: "counting another type than the one on screen, across a hop, on a large table",
  },
  {
    id: "snb-post-browsers",
    example: "snb",
    page: { root: "Person" },
    ask: ["Which browsers are posts written from?"],
    holds: [["Firefox", 53312], ["Internet Explorer", 36600], ["Chrome", 35050]],
    tests: "a breakdown over 135,701 rows",
  },
  {
    id: "snb-long-comments",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many comments are longer than 100 characters?"],
    // select count(*) from comment where length > 100
    holds: [[null, 7621]],
    tests: "a numeric range written as a comparison",
  },
  {
    id: "snb-longest-comment",
    example: "snb",
    page: { root: "Person" },
    ask: ["How long is the longest comment?"],
    // select max(length) from comment: a measure other than a count
    holds: [[null, 1988]],
    tests: "a maximum, not a count",
  },
  {
    id: "snb-friendships-2011",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many friendships were made in 2011?"],
    // A knowing is the relation as a vertex, with its date: 5,559 of 14,073 began in 2011.
    holds: [[null, 5559]],
    tests: "the relation as a vertex, with a date range on it",
  },
  {
    id: "snb-women-chrome",
    example: "snb",
    page: { root: "Person" },
    ask: ["How many women use Chrome?"],
    holds: [[null, 224]],
    tests: "two category conditions at once",
  },
  {
    id: "snb-most-friends-tie",
    example: "snb",
    page: { root: "Person" },
    ask: ["Who has the most friends?"],
    expects: "question",
    // A knowing reaches a person as its knower and as its known: two equally short ways.
    holds: [],
    tests: "a tie on a relation that points at one type twice",
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
