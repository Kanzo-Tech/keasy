// @vitest-environment node
import type { Engine } from "@kanzo-tech/mosaic";
import { describe, expect, it } from "vitest";

import { attachInMemory } from "./memory-corpus";

const MANIFEST = {
  format: "fossil/1",
  vertex_tables: [
    {
      name: "Person",
      path: "vertex/Person.parquet",
      record_count: 2,
      identity: "subject",
      properties: [
        { name: "dense_id", type: "UInt64", role: "address" },
        { name: "subject", type: "Utf8", role: "identity" },
      ],
    },
  ],
  edge_tables: [],
};

/**
 * DuckDB-WASM as fossil's attach meets it: a registry of buffers, `read_text` answered from it, and
 * every other statement kept to be read.
 */
function fakeEngine() {
  const files = new Map<string, Uint8Array>();
  const statements: string[] = [];
  const engine = {
    coordinator: {},
    registerFiles: async () => {},
    registerFileBuffer: async (name: string, bytes: Uint8Array) => void files.set(name, bytes.slice()),
    dropFiles: async (names: readonly string[]) => names.forEach((n) => files.delete(n)),
    query: async (sql: string) => {
      statements.push(sql);
      const read = /read_text\('([^']+)'\)/.exec(sql);
      const bytes = read ? files.get(read[1]!) : undefined;
      if (read && !bytes) throw new Error(`IO Error: No files found that match the pattern "${read[1]}"`);
      const content = bytes ? new TextDecoder().decode(bytes) : null;
      return { numRows: content === null ? 0 : 1, getChild: () => ({ get: () => content }) };
    },
  };
  return { engine: engine as unknown as Engine, files, statements };
}

const corpus = () => [
  { path: "fossil.json", bytes: new TextEncoder().encode(JSON.stringify(MANIFEST)) },
  { path: "vertex/Person.parquet", bytes: new Uint8Array([80, 65, 82, 49]) },
];

describe("a corpus answered in memory", () => {
  it("is attached from its registered buffers, as a corpus at a URL", async () => {
    const { engine, files, statements } = fakeEngine();
    const attached = await attachInMemory("preview-abc", corpus(), { engine });
    expect(attached.name).toBe("preview-abc");
    const [prefix] = [...files.keys()][0]!.split("fossil.json");
    expect([...files.keys()]).toEqual([`${prefix}fossil.json`, `${prefix}vertex/Person.parquet`]);
    expect(statements).toContain(`ATTACH IF NOT EXISTS ':memory:' AS "preview-abc"`);
    expect(statements.some((s) => s.includes(`"preview-abc"."Person"`) && s.includes(`read_parquet('${prefix}vertex/Person.parquet')`))).toBe(true);

    await attached.detach();
    await attached.detach();
    expect(statements.filter((s) => s.startsWith("DETACH"))).toEqual([`DETACH DATABASE IF EXISTS "preview-abc"`]);
    expect(files.size).toBe(0);
  });

  it("gives each attach its own files, so one run again does not lose them to the one it replaces", async () => {
    const { engine, files } = fakeEngine();
    const first = await attachInMemory("preview-abc", corpus(), { engine });
    const second = await attachInMemory("preview-abc", corpus(), { engine });
    await first.detach();
    expect(files.size).toBe(2);
    await second.detach();
    expect(files.size).toBe(0);
  });

  it("gives its buffers back when the attach fails", async () => {
    const { engine, files } = fakeEngine();
    const broken = [{ path: "fossil.json", bytes: new TextEncoder().encode("not json") }];
    await expect(attachInMemory("preview-x", broken, { engine })).rejects.toMatchObject({ code: "corpus/not-json" });
    expect(files.size).toBe(0);
  });
});
