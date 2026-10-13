import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The engine is not what is tested here, and WebLLM expects a browser.
vi.mock("@kanzo-tech/llm/local", () => ({ loadLocalModel: vi.fn(), localModel: vi.fn() }));

const { LIBRARY, MODEL, WEIGHTS } = await import("./ai");

const SCRIPT = readFileSync(join(__dirname, "..", "..", "..", "infra", "models.sh"), "utf8");
const pin = (name: string) => SCRIPT.match(new RegExp(`^${name}=(\\S+)$`, "m"))?.[1];

/**
 * The model's pins are one: what `make models` downloads (`infra/models.sh`) is what the page asks
 * for under `KEASY_MODEL_URL`, and its library is compiled for the WebLLM the page runs.
 *
 * Cannot prove: that the revision and the library are a pair that load together — a browser with
 * WebGPU does (`make models`, then Ask).
 */
describe("the model's pins", () => {
  it("are the ones the download script fetches", () => {
    expect(pin("model")).toBe(MODEL);
    expect(WEIGHTS).toBe(`${pin("model")}/resolve/${pin("revision")}/`);
    expect(LIBRARY).toBe(`lib/${pin("webllm")}/${pin("library")}`);
  });

  it("name a library compiled for the WebLLM that is installed", () => {
    // A bump of @mlc-ai/web-llm without its library is a model that fails to load, found here instead.
    const { version } = createRequire(__filename)("@mlc-ai/web-llm/package.json") as { version: string };
    expect(pin("webllm")).toBe(`v${version.replaceAll(".", "_")}`);
  });
});
