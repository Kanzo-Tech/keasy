import { describe, expect, it } from "vitest";
import { delimiterOf, profiledOf, thingName } from "./profile";
import { INPUTS, NOBEL, PROFILE } from "./nobel.fixture";

describe("the profile, as the Tasks read it", () => {
  it("names each source by its binding and each inclusion by the columns it joins", () => {
    expect(NOBEL.sources.map((s) => s.name)).toEqual(["laureates", "awards", "institutions", "affiliations", "countries"]);
    expect(NOBEL.inclusions.map((i) => i.id)).toEqual([
      "awards.laureate_id → laureates.id",
      "affiliations.laureate_id → laureates.id",
      "affiliations.institution_id → institutions.id",
    ]);
    expect(NOBEL.sources[0]!.columns.find((c) => c.name === "born")).toEqual({ name: "born", primitive: "date", nulls: 1, distinct: 3 });
  });

  it("says no count where the profile read a sample", () => {
    const sampled = { ...PROFILE, sources: PROFILE.sources.map((s, i) => (i === 0 ? { ...s, sampled: true } : s)) };
    expect(profiledOf(sampled, INPUTS).sources.map((s) => s.rows)).toEqual([null, 4, 2, 3, 2]);
  });

  it("gives two sources of one binding two names", () => {
    const twice = PROFILE.sources[0]!;
    const key = "https://elsewhere.example/laureates.csv";
    const other = { ...twice, descriptor: { ...twice.descriptor, key } };
    const profiled = profiledOf({ ...PROFILE, sources: [twice, other], inclusions: [] }, [INPUTS[0]!, { ...INPUTS[0]!, key, location: key }]);
    expect(profiled.sources.map((s) => s.name)).toEqual(["laureates", "laureates_2"]);
  });

  it("reads a binding's delimiter", () => {
    expect(delimiterOf('delimiter = "|"')).toBe("|");
    expect(delimiterOf(undefined)).toBeUndefined();
  });

  it("reads a file's name as a thing's", () => {
    expect(thingName("nobel_laureates.csv")).toBe("Nobel laureates");
  });
});
