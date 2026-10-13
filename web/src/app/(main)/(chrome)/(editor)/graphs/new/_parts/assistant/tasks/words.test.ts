import { describe, expect, it } from "vitest";

import { holdsLine, inWords, thingName } from "./words";

describe("the words the assistant says", () => {
  it("counts in words, the noun plural unless there is one", () => {
    expect(inWords(1, "thing")).toBe("one thing");
    expect(inWords(2, "thing")).toBe("two things");
    expect(inWords(12, "thing")).toBe("12 things");
  });

  it("says what each one holds in the data's own words, made readable", () => {
    expect(holdsLine([])).toBeNull();
    expect(holdsLine(["name", "gender"])).toBe("name and gender");
    expect(holdsLine(["name", "gender", "birth_date", "birth_country", "died"])).toBe(
      "name, gender, birth date, birth country and died",
    );
    expect(holdsLine(["id", "name", "gender", "birth_date", "birth_country", "died"])).toBe(
      "id, name, gender, birth date and 2 more",
    );
  });

  it("reads a file's name as a thing's", () => {
    expect(thingName("nobel_laureates.csv")).toBe("Nobel laureates");
  });
});
