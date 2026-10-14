import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "..", "..", "infra", "models.sh");

/** What `make models` lists at /models: its `app-config.json`, the one model the page serves. */
const listing = JSON.parse(execFileSync("sh", [SCRIPT, "--app-config"], { encoding: "utf8" })) as {
  model_list: { model: string; model_id: string; model_lib: string; [field: string]: unknown }[];
};

/**
 * The model the page serves is the one WebLLM knows: what `infra/models.sh` downloads and lists is
 * WebLLM's own record for the model, at the release installed — its memory and its context window
 * included, which the listing now carries since no prebuilt record is consulted — and its library is
 * compiled for that release.
 *
 * Cannot prove: that the revision and the library are a pair that load together — a browser with
 * WebGPU does (`make models`, then Ask).
 */
describe("the model's listing", () => {
  it("is WebLLM's record of the model, at the paths it is downloaded to", async () => {
    const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
    const [served] = listing.model_list;
    const known = prebuiltAppConfig.model_list.find((m) => m.model_id === served?.model_id);
    expect(listing.model_list).toHaveLength(1);
    expect(known).toBeDefined();
    // Where it is differs — the listing names this origin's copy — and nothing else may.
    const at = (record: object) => ({ ...record, model: undefined, model_lib: undefined });
    expect(at(served!)).toEqual(at(known!));
    expect(served!.model_lib.split("/").at(-1)).toBe(known!.model_lib.split("/").at(-1));
    expect(served!.model).toMatch(new RegExp(`^${served!.model_id}/resolve/[0-9a-f]{40}/$`));
  });

  it("names a library compiled for the WebLLM that is installed", () => {
    // A bump of @mlc-ai/web-llm without its library is a model that fails to load, found here instead.
    const { version } = createRequire(__filename)("@mlc-ai/web-llm/package.json") as { version: string };
    expect(listing.model_list[0]!.model_lib).toContain(`/v${version.replaceAll(".", "_")}/`);
  });
});
