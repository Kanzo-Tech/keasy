import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import type { Model } from "@fossil-lang/types";
import { infer, initFossilWasm } from "@fossil-lang/wasm";
import { type Check, fossilCheck, writeProgram } from "./mapping";
import { DESCRIBING, PROFILE } from "./nobel.fixture";

const BASE = "https://acme.example/";
let model: Model;
let check: Check;

beforeAll(async () => {
  await initFossilWasm(readFileSync(createRequire(import.meta.url).resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  model = (await infer(PROFILE, { choices: { "count/affiliations": "link" } })).model;
  const host = { connections: async () => ({}), credentials: async () => [] };
  check = fossilCheck({ host, engine: DESCRIBING });
});

describe("the program", () => {
  it("is fossil's writing of the model, every IRI under the workspace, and fossil checks it clean", async () => {
    const program = await writeProgram(model, { base: BASE, check });
    expect(program).toContain("type Laureates");
    expect(program).toContain("https://acme.example/vocab/");
  });

  it("throws what fossil says when it does not compile", async () => {
    const broken: Model = { ...model, types: model.types.map((t) => (t.name === "Institutions" ? { ...t, fields: [{ ...t.fields[0]!, column: "nmae" }] } : t)) };
    await expect(writeProgram(broken, { base: BASE, check })).rejects.toMatchObject({ code: "task/unheld", title: "The program written for these files does not compile." });
  });
});
