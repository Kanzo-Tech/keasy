/**
 * A small Nobel, as fossil's profile answers it — laureates, their awards, the institutions they
 * were at and the affiliations linking the two, and a countries file nothing points at. For the
 * steps' tests only.
 */

import type { Engine, Primitive, Profile } from "@fossil-lang/types";
import { profiledOf } from "./profile";

const BASE = "https://data.example/nobel/";

type Col = [name: string, primitive: Primitive, nulls?: number];

function source(file: string, columns: Col[], keys: string[], sample: (string | null)[][]): Profile["sources"][number] {
  return {
    binding: file.replace(/\.csv$/, ""),
    format: "csv",
    descriptor: { key: `${BASE}${file}`, etag: "", columns: columns.map(([name, primitive]) => ({ name, primitive })) },
    columns: columns.map(([name, , nulls = 0]) => ({ name, null_count: nulls, distinct_count: sample.length })),
    candidate_keys: keys,
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
    { from: { source: "awards", column: "laureate_id" }, to: { source: "laureates", column: "id" } },
    { from: { source: "affiliations", column: "laureate_id" }, to: { source: "laureates", column: "id" } },
    { from: { source: "affiliations", column: "institution_id" }, to: { source: "institutions", column: "id" } },
  ],
  failed: [],
};

export const NOBEL = profiledOf(PROFILE);

/** The DuckDB type a fixture column is described as; a file holds no language-tagged string. */
const DUCKDB: Record<Exclude<Primitive, "lang_string">, string> = {
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
    const rows = described.descriptor.columns.map((c) => [c.name, DUCKDB[c.primitive as Exclude<Primitive, "lang_string">], "YES", null, null, null]);
    return {
      numRows: rows.length,
      schema: { fields: header.map((name) => ({ name })) },
      getChild: (name: string) => ({ get: (i: number) => rows[i]![header.indexOf(name)] }),
    } as unknown as Awaited<ReturnType<Engine["query"]>>;
  },
  registerFiles: async () => [],
  dropFiles: async () => undefined,
} as unknown as Engine;
