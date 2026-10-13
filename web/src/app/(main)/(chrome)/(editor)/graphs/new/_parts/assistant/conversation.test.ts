import { describe, expect, it } from "vitest";

import { converse, holdsLine, inWords, NO_REPLIES, type Replies, waitingFor } from "./conversation";
import { blocks, type DecisionItem } from "./model";

/** No safe default: whether a shared Nobel is one award or two has two right answers. */
const open: DecisionItem = {
  decision: {
    id: "award-key",
    question: "When two people share a Nobel, do you count one award or two?",
    options: [
      { id: "two", label: "Two, one per person" },
      { id: "one", label: "One, shared" },
    ],
  },
  assumed: null,
  chosen: null,
};

/** A safe default, taken. */
const assumed: DecisionItem = {
  decision: {
    id: "share",
    question: "Is “share” a fraction of the prize, or an amount?",
    options: [
      { id: "fraction", label: "A fraction of the prize" },
      { id: "amount", label: "An amount of money" },
    ],
  },
  assumed: "fraction",
  chosen: null,
};

const picked = new Set(["nobel:laureates.csv", "nobel:awards.csv"]);
const kinds = (data: Parameters<typeof converse>[0], replies: Partial<Replies>) =>
  converse(data, { ...NO_REPLIES, ...replies }).turns.map((t) => t.kind);

describe("the conversation", () => {
  it("asks for the files first, and waits on them", () => {
    const { turns, waiting } = converse({ selected: new Set(), reading: null, decisions: null, questions: [] }, NO_REPLIES);
    expect(turns.map((t) => t.kind)).toEqual(["pick"]);
    expect(waiting).toBe("pick");
  });

  it("asks what it is about while the files are read, and goes on only once they are", () => {
    const reading = { done: 4, total: 6 };
    expect(kinds({ selected: picked, reading, decisions: null, questions: [] }, { picked: true })).toEqual([
      "pick",
      "picked",
      "reading",
      "about",
    ]);
    const skipped = converse({ selected: picked, reading, decisions: null, questions: [] }, { ...NO_REPLIES, picked: true, about: "" });
    expect(skipped.waiting).toBe("reading");
    expect(skipped.turns.at(-1)).toEqual({ kind: "about-reply", text: "" });
  });

  it("says what is in the data, then asks each open decision as a turn of its own and waits on it", () => {
    const data = { selected: picked, reading: null, decisions: [open, assumed], questions: [] };
    const at = converse(data, { ...NO_REPLIES, picked: true, about: "" });
    expect(at.turns.map((t) => t.kind)).toEqual(["pick", "picked", "reading", "about", "about-reply", "understood", "decide"]);
    expect(at.waiting).toBe("decide");
  });

  it("an assumption is said and blocks nothing; a chosen decision is the person's reply", () => {
    const data = { selected: picked, reading: null, decisions: [{ ...open, chosen: "two" }, assumed], questions: [] };
    const { turns, waiting } = converse(data, { ...NO_REPLIES, picked: true, about: "Nobel prizes" });
    expect(turns.slice(5).map((t) => t.kind)).toEqual(["understood", "decide", "decided", "assumed", "ask"]);
    expect(waiting).toBe("ask");
    expect(blocks(assumed)).toBe(false);
    expect(blocks(open)).toBe(true);
  });

  it("each question kept is a reply, and the graph is built once the person says that is all", () => {
    const questions = [{ id: "q1", text: "Who won twice?", answerable: true }];
    const data = { selected: picked, reading: null, decisions: [], questions };
    const { turns, waiting } = converse(data, { picked: true, about: "", asked: true });
    expect(turns.slice(-4).map((t) => t.kind)).toEqual(["ask", "asked", "asked-all", "build"]);
    expect(waiting).toBeNull();
  });
});

describe("what a turn says", () => {
  it("says why the reply cannot be given yet", () => {
    expect(waitingFor("pick", 0)).toBe("Pick at least one file");
    expect(waitingFor("pick", 2)).toBeNull();
    expect(waitingFor("reading", 2)).toBe("Wait for the files to be read");
    expect(waitingFor("decide", 2)).toBe("Choose an option above to continue");
  });

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
});
