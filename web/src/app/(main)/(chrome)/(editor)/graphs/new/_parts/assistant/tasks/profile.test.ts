import { describe, expect, it } from "vitest";
import { profiledOf, thingName } from "./profile";
import { NOBEL, PROFILE } from "./nobel.fixture";

describe("the profile, as the Tasks read it", () => {
  it("names each source by its binding and each inclusion by the columns it joins", () => {
    expect(NOBEL.sources.map((s) => s.name)).toEqual(["laureates", "awards", "institutions", "affiliations", "countries"]);
    expect(NOBEL.inclusions.map((i) => i.id)).toEqual([
      "awards.laureate_id → laureates.id",
      "affiliations.laureate_id → laureates.id",
      "affiliations.institution_id → institutions.id",
    ]);
    expect(NOBEL.sources[0]!.columns.find((c) => c.name === "born")).toEqual({ name: "born", primitive: "time_date", nulls: 1, distinct: 3 });
  });

  it("says no count where the profile read a sample", () => {
    const sampled = { ...PROFILE, sources: PROFILE.sources.map((s, i) => (i === 0 ? { ...s, sampled: true } : s)) };
    expect(profiledOf(sampled).sources.map((s) => s.rows)).toEqual([null, 4, 2, 3, 2]);
  });

  it("reads a file's name as a thing's", () => {
    expect(thingName("nobel_laureates.csv")).toBe("Nobel laureates");
  });
});
