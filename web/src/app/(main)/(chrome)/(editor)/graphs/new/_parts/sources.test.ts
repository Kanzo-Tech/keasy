import { describe, expect, it } from "vitest";
import type { ProviderInfo } from "@fossil-lang/wasm";
import type { StorageConnection } from "@/lib/connections";
import { bindingName, childrenOf, connectionNode } from "./sources";

const providers: ProviderInfo[] = [
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
  ];

  it("lists the folders holding something readable, then the readable files", () => {
    const top = childrenOf(connectionNode(snb), keys, providers);
    expect(top.map((n) => n.name)).toEqual(["dynamic/", "static/"]);
    expect(top[0]).toMatchObject({ under: "dynamic/", childrenCount: 1 });
  });

  it("writes each file's whole line, its reader from the extension", () => {
    const dynamic = childrenOf(connectionNode(snb), keys, providers)[0];
    const inside = childrenOf(dynamic, keys, providers);
    expect(inside.map((n) => n.name)).toEqual(["deeper/", "person_0_0.csv"]);
    expect(inside[1]).toMatchObject({
      reader: "csv",
      line: 'person_0_0 := io.csv("@snb/dynamic/person_0_0.csv")',
    });
  });
});

describe("bindingName", () => {
  it("is an identifier whatever the file is called", () => {
    expect(bindingName("person_0_0.csv")).toBe("person_0_0");
    expect(bindingName("snb.shacl.ttl")).toBe("snb_shacl");
    expect(bindingName("2024 sales.csv")).toBe("_2024_sales");
  });
});
