/**
 * A small Nobel, as fossil's profile answers it — laureates, their awards, the institutions they
 * were at and the affiliations linking the two, and a countries file nothing points at. For the
 * steps' tests only.
 */

import type { DataType, Engine, Field, Primitive, Profile, Table } from "@fossil-lang/types";
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
      [["id", "integer"], ["name", "string"], ["gender", "string"], ["born", "time_date", 1]],
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

/** The Arrow type an engine answers a fixture column with, as apache-arrow numbers them (`Schema.fbs`). */
const ARROW: Partial<Record<Primitive, DataType>> = {
  string: { typeId: 5 },
  integer: { typeId: 2, bitWidth: 64, isSigned: true },
  float: { typeId: 3, precision: 2 },
  bool: { typeId: 6 },
  time_date: { typeId: 8, unit: 0 },
};

/** An answer of no row whose fields are `fields`. */
const fieldsOf = (fields: Field[]): Table => ({ numRows: 0, schema: { fields }, getChild: () => null });

/**
 * An engine that answers the query of a fixture file's columns with them, as DuckDB-WASM would —
 * all fossil's `describe` asks at `depth: "types"` — and says every extension is loaded. Every
 * other statement answers no row.
 */
export const DESCRIBING: Engine = {
  async query(sql: string) {
    if (sql.includes("duckdb_extensions()")) {
      return { numRows: 1, schema: { fields: [{ name: "loaded", nullable: false, type: ARROW.bool! }] }, getChild: () => ({ length: 1, get: () => true, toArray: () => [true] }) };
    }
    const described = PROFILE.sources.find((s) => sql.includes(s.descriptor.key));
    if (!described || !sql.endsWith(" LIMIT 0")) return fieldsOf([]);
    return fieldsOf(described.descriptor.columns.map((c) => ({ name: c.name, nullable: true, type: ARROW[c.primitive]! })));
  },
  registerFiles: async () => undefined,
  registerFileBuffer: async () => undefined,
  dropFiles: async () => undefined,
};
