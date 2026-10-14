import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import type { Format } from "@fossil-lang/types";
import type { StorageConnection } from "@/lib/connections";
import { childrenOf, connectionNode } from "./sources";

const formats: Format[] = [
  { name: "csv", extensions: ["csv"], kind: "data" },
  { name: "shex", extensions: ["shex"], kind: "schema" },
];

const snb: StorageConnection = {
  name: "snb",
  url: "s3://lake/ldbc/",
  kind: "data",
  direction: "source",
  secret: "aws",
};

describe("childrenOf", () => {
  const keys = [
    "ldbc/README.md",
    "ldbc/static/tag_0_0.csv",
    "ldbc/dynamic/person_0_0.csv",
    "ldbc/dynamic/deeper/post_0_0.csv",
    "ldbc/dynamic/notes.txt",
    "ldbc/empty/notes.txt",
  ].map((path, i) => ({ path, size: 100 * i }));

  beforeAll(async () => {
    await initFossilWasm(readFileSync(createRequire(import.meta.url).resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  });

  it("lists the folders holding something readable, then the readable files", async () => {
    const top = await childrenOf(connectionNode(snb), keys, formats);
    expect(top.map((n) => n.name)).toEqual(["dynamic/", "static/"]);
    expect(top[0]).toMatchObject({ kind: "folder", under: "dynamic/" });
    expect(top[0]).not.toHaveProperty("children");
  });

  it("writes each file's whole line, bound by fossil's name for it, its reader from the extension, and its size", async () => {
    const [dynamic] = await childrenOf(connectionNode(snb), keys, formats);
    if (dynamic?.kind !== "folder") throw new Error("dynamic/ is a folder");
    const inside = await childrenOf(dynamic, keys, formats);
    expect(inside.map((n) => n.name)).toEqual(["deeper/", "person_0_0.csv"]);
    expect(inside[1]).toMatchObject({
      reader: "csv",
      line: 'person_0_0 := io.csv("@snb/dynamic/person_0_0.csv")',
      size: 200,
    });
  });
});
