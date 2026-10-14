/**
 * A small Nobel, as fossil's profile answers it — laureates, their awards, the institutions they
 * were at and the affiliations linking the two, and a countries file nothing points at — with a
 * model that answers each call with the next scripted reply. For the Tasks' tests only.
 */

import { promptOf, scriptedModel } from "@kanzo-tech/llm/testing";
import type { Engine, Input, Primitive, Profile } from "@fossil-lang/types";
import type { Draft } from "./model";
import { profiledOf } from "./profile";

const BASE = "https://data.example/nobel/";

type Col = [name: string, primitive: Primitive, nulls?: number];

function source(file: string, columns: Col[], keys: string[], sample: (string | null)[][]): Profile["sources"][number] {
  return {
    descriptor: { key: `${BASE}${file}`, etag: "", columns: columns.map(([name, primitive]) => ({ name, primitive })) },
    columns: columns.map(([name, , nulls = 0]) => ({ name, nulls, distinct: sample.length })),
    keys,
    rows: sample.length,
    sampled: false,
    sample: sample as string[][],
  };
}

export const PROFILE: Profile = {
  sources: [
    source(
      "laureates.csv",
      [["id", "integer"], ["name", "string"], ["gender", "string"], ["born", "date", 1]],
      ["id", "name"],
      [
        ["1", "Marie Curie", "female", "1867-11-07"],
        ["2", "Pierre Curie", "male", "1859-05-15"],
        ["3", "Albert Einstein", "male", null],
      ],
    ),
    source(
      "awards.csv",
      [["id", "integer"], ["year", "integer"], ["category", "string"], ["laureate_id", "integer"], ["share", "integer"]],
      ["id"],
      [
        ["10", "1903", "Physics", "1", "4"],
        ["11", "1903", "Physics", "2", "4"],
        ["12", "1911", "Chemistry", "1", "1"],
        ["13", "1921", "Physics", "3", "1"],
      ],
    ),
    source(
      "institutions.csv",
      [["id", "integer"], ["name", "string"], ["city", "string"]],
      ["id"],
      [
        ["100", "Sorbonne", "Paris"],
        ["101", "Kaiser Wilhelm Institute", "Berlin"],
      ],
    ),
    source(
      "affiliations.csv",
      [["laureate_id", "integer"], ["institution_id", "integer"]],
      [],
      [
        ["1", "100"],
        ["2", "100"],
        ["3", "101"],
      ],
    ),
    source("countries.csv", [["code", "string"], ["name", "string"]], ["code", "name"], [["FR", "France"], ["DE", "Germany"]]),
  ],
  inclusions: [
    { from: { source: `${BASE}awards.csv`, column: "laureate_id" }, to: { source: `${BASE}laureates.csv`, column: "id" } },
    { from: { source: `${BASE}affiliations.csv`, column: "laureate_id" }, to: { source: `${BASE}laureates.csv`, column: "id" } },
    { from: { source: `${BASE}affiliations.csv`, column: "institution_id" }, to: { source: `${BASE}institutions.csv`, column: "id" } },
  ],
  failed: [],
};

/** The picked files, as `inputs()` answers their binding lines. */
export const INPUTS: Input[] = ["laureates", "awards", "institutions", "affiliations", "countries"].map((binding) => ({
  binding,
  key: `${BASE}${binding}.csv`,
  location: `${BASE}${binding}.csv`,
  format: "csv",
  role: "data",
}));

export const NOBEL = profiledOf(PROFILE, INPUTS);

/** What a good model proposes over it. */
export const DRAFT: Draft = {
  types: [
    { name: "Laureate", source: "laureates", key: "id", fields: [{ name: "name", column: "name" }, { name: "gender", column: "gender" }, { name: "born", column: "born" }] },
    { name: "Award", source: "awards", key: "id", fields: [{ name: "year", column: "year" }, { name: "category", column: "category" }, { name: "share", column: "share" }] },
    { name: "Institution", source: "institutions", key: "id", fields: [{ name: "name", column: "name" }, { name: "city", column: "city" }] },
    { name: "Country", source: "countries", key: "code", fields: [{ name: "name", column: "name" }] },
  ],
  edges: [
    { name: "laureate", from: "Award", to: "Laureate", via: "awards.laureate_id → laureates.id" },
    { name: "affiliation", from: "Laureate", to: "Institution", via: "affiliations.institution_id → institutions.id" },
  ],
};

/**
 * `@kanzo-tech/llm/testing`'s model, answering each call with the next of `replies` — an object as
 * its JSON, a string as it is — and the last one after that, keeping every prompt it was asked.
 */
export function scripted(...replies: unknown[]) {
  const prompts: string[] = [];
  const model = scriptedModel({
    turns: (call, index) => {
      prompts.push(promptOf(call));
      const reply = replies[Math.min(index, replies.length - 1)];
      return typeof reply === "string" ? { text: reply } : { object: reply };
    },
  });
  return { model, prompts };
}

const DUCKDB: Record<Primitive, string> = {
  string: "VARCHAR",
  integer: "BIGINT",
  float: "DOUBLE",
  bool: "BOOLEAN",
  date: "DATE",
  date_time: "TIMESTAMP",
  time: "TIME",
  g_year: "INTEGER",
  any_uri: "VARCHAR",
};

/**
 * An engine that answers a `DESCRIBE` of a fixture file with its columns, as DuckDB would — all
 * fossil's `describe` asks at `depth: "types"`. Nothing else is answered.
 */
export const DESCRIBING: Engine = {
  async query(sql: string) {
    const described = PROFILE.sources.find((s) => sql.includes(s.descriptor.key));
    if (!/^DESCRIBE/.test(sql) || !described) throw new Error(`The fixture engine answers no ${sql}`);
    const header = ["column_name", "column_type", "null", "key", "default", "extra"];
    const rows = described.descriptor.columns.map((c) => [c.name, DUCKDB[c.primitive], "YES", null, null, null]);
    return {
      numRows: rows.length,
      schema: { fields: header.map((name) => ({ name })) },
      getChild: (name: string) => ({ get: (i: number) => rows[i]![header.indexOf(name)] }),
    } as unknown as Awaited<ReturnType<Engine["query"]>>;
  },
  registerFiles: async () => [],
  dropFiles: async () => undefined,
} as unknown as Engine;
