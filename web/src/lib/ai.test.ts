import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";

/** What the page serves at /models/app-config.json: a static file of the web, the one model it asks. */
const listing = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "models", "app-config.json"), "utf8")) as AppConfig;

const COMMIT = "[0-9a-f]{40}";

/** Every string in the listing that is a URL, wherever it sits. */
function urls(value: unknown): string[] {
  if (typeof value === "string") return /^[a-z]+:|^\.{0,2}\//.test(value) ? [value] : [];
  if (value && typeof value === "object") return Object.values(value).flatMap(urls);
  return [];
}

/**
 * The model the page serves is the one WebLLM knows, and fetched from where it says: the listing is
 * WebLLM's own record of the model at the release installed — its memory and its context window
 * included — with the two URLs of its prebuilt record pinned to a commit and its SRI hashes added.
 *
 * Cannot prove: that the files at those commits are the ones the hashes were computed from — a
 * browser with WebGPU does (open a graph) — nor that the weights, which WebLLM does not hash, are
 * unchanged: the commit is their only pin.
 */
describe("the model's listing", () => {
  it("is WebLLM's record of the model, its URLs pinned", async () => {
    const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
    const [served] = listing.model_list;
    const known = prebuiltAppConfig.model_list.find((m) => m.model_id === served?.model_id);
    expect(listing.model_list).toHaveLength(1);
    expect(known).toBeDefined();
    // Where the files are, and their hashes, differ — nothing else may.
    const at = (record: object) => ({ ...record, model: undefined, model_lib: undefined, integrity: undefined });
    expect(at(served!)).toEqual(at(known!));
    expect(served!.model_lib.split("/").at(-1)).toBe(known!.model_lib.split("/").at(-1));
    expect(Object.keys(listing).sort()).toEqual(["model_list"]);
  });

  it("names every file at a commit, never a branch, from a host WebLLM's own list uses", () => {
    const [served] = listing.model_list;
    expect(served!.model).toMatch(new RegExp(`^https://huggingface\\.co/mlc-ai/${served!.model_id}/resolve/${COMMIT}/$`));
    expect(served!.model_lib).toMatch(
      new RegExp(`^https://raw\\.githubusercontent\\.com/mlc-ai/binary-mlc-llm-libs/${COMMIT}/web-llm-models/v[0-9_]+/base/[\\w.-]+\\.wasm$`),
    );
    const all = urls(listing);
    expect(all).toHaveLength(2);
    for (const url of all) {
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toMatch(/\/(main|master|HEAD)(\/|$)/);
    }
  });

  it("names a library compiled for the WebLLM that is installed", () => {
    // A bump of @mlc-ai/web-llm without its library is a model that fails to load, found here instead.
    const { version } = createRequire(__filename)("@mlc-ai/web-llm/package.json") as { version: string };
    expect(listing.model_list[0]!.model_lib).toContain(`/v${version.replaceAll(".", "_")}/`);
  });

  it("carries the SRI hash of each file WebLLM verifies", async () => {
    const { isValidSRI } = await import("@mlc-ai/web-llm");
    const { integrity } = listing.model_list[0]!;
    expect(integrity?.onFailure).toBeUndefined(); // the default is an error, not a warning
    const hashes = [integrity?.config, integrity?.model_lib, integrity?.tokenizer?.["tokenizer.json"]];
    for (const hash of hashes) expect(hash !== undefined && isValidSRI(hash)).toBe(true);
    expect(Object.keys(integrity?.tokenizer ?? {})).toEqual(["tokenizer.json"]);
  });
});
