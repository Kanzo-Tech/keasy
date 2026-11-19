import { describe, expect, it } from "vitest";
import { runTask } from "@kanzo-tech/ai/task";
import { ClientError } from "@/lib/errors";
import { modelTask } from "./tasks/model";
import { NAMES, NOBEL, scripted } from "./tasks/nobel.fixture";
import { held } from "./use-assistant";

describe("a Task whose answer did not hold", () => {
  it("fails as what it wrote and why, not as a model call that failed", async () => {
    const twin = { ...NAMES, types: { ...NAMES.types, countries: "Award" } };
    const proposal = await runTask(modelTask(NOBEL), { profiled: NOBEL, about: "" }, { model: scripted(twin).model });
    let thrown: unknown;
    try {
      held(proposal);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClientError);
    expect(thrown).toMatchObject({ code: "task/unheld", title: "The names did not hold after 3 attempts." });
    expect((thrown as Error).message).toBe("countries and awards are both called Award.");
  });
});
