import { describe, expect, it } from "vitest";
import type { Manifest, VertexTable } from "@fossil-lang/corpus";
import { bookkeeping, graphKey, summarize } from "./field-stats";

const PERSON: VertexTable = {
  name: "Person",
  path: "vertex/Person.parquet",
  key: "dense_id",
  identity: "subject",
  record_count: 1000,
  properties: [
    { name: "dense_id", type: "uint32", role: "address" },
    { name: "subject", type: "string", role: "identity" },
    { name: "x", type: "float", role: "coordinate" },
    { name: "y", type: "float", role: "coordinate" },
    { name: "cluster_id", type: "uint32", role: "categorical" },
    { name: "country", type: "string" },
  ],
  position: { by: "layout", x: "x", y: "y" },
};

/** The same table as a corpus written before columns carried a role. */
const UNROLED: VertexTable = { ...PERSON, properties: PERSON.properties.map(({ name, type }) => ({ name, type })) };

const summary = (...names: string[]) =>
  names.map((name) => ({ column_name: name, column_type: "VARCHAR", approx_unique: 12, min: null, max: null, count: 1000 }));

describe("field-stats", () => {
  it("hides every column fossil gave a role", () => {
    expect(bookkeeping(PERSON)).toEqual(["dense_id", "subject", "x", "y", "cluster_id"]);
  });

  it("hides what the manifest has always declared when the corpus predates roles", () => {
    expect(bookkeeping(UNROLED)).toEqual(["dense_id", "subject", "x", "y"]);
    expect(bookkeeping({ ...UNROLED, position: { by: "program", x: "lon", y: "lat" } })).toEqual(["dense_id", "subject"]);
  });

  it("keeps bookkeeping out of the fields and in the columns a rule may check", () => {
    const stats = summarize(PERSON, summary("dense_id", "subject", "x", "y", "cluster_id", "country"));
    expect(stats.fields.map((f) => f.name)).toEqual(["country"]);
    expect(stats.columns).toEqual(["dense_id", "subject", "x", "y", "cluster_id", "country"]);
    expect(stats.count).toBe(1000);
  });

  it("reads the graph's key from the manifest, and refuses a corpus with no vertex table", () => {
    const manifest = (vertex_tables: VertexTable[]): Manifest => ({ format: "fossil/1", vertex_tables, edge_tables: [] });
    expect(graphKey(manifest([{ ...PERSON, key: "vid" }]))).toBe("vid");
    expect(() => graphKey(manifest([]))).toThrow();
  });
});
