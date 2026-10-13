import { describe, expect, it } from "vitest";

import { toStored } from "@/lib/assistant-conversation";
import { converse, messagesOf, NO_REPLIES, type Replies, restore, waitingFor } from "./conversation";
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

  it("each question kept is a reply, and once the person says that is all, the preview, then the build", () => {
    const questions = [{ id: "q1", text: "Who won twice?", answerable: true }];
    const data = { selected: picked, reading: null, decisions: [], questions };
    const { turns, waiting } = converse(data, { picked: true, about: "", asked: true });
    expect(turns.slice(-5).map((t) => t.kind)).toEqual(["ask", "asked", "asked-all", "preview", "build"]);
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
});

describe("what is kept of the conversation", () => {
  const files = [
    { connection: "nobel", path: "laureates.csv" },
    { connection: "nobel", path: "awards.csv" },
  ];
  const questions = [{ id: "q1", text: "Who won twice?", answerable: true }];
  const done = { picked: true, about: "Nobel prizes", asked: true };
  const turnsOf = (decisions: DecisionItem[], replies: Replies = done) =>
    converse({ selected: picked, reading: null, decisions, questions }, replies).turns;

  it("is a message per turn, its kind and what the person picked, chose or typed — nothing the gate strips", () => {
    const messages = messagesOf(turnsOf([{ ...open, chosen: "one" }, assumed]), { files, program: "program" });
    expect(toStored(messages)).toEqual(messages);
    expect(messages.map((m) => `${m.role}:${m.id}`)).toEqual([
      "assistant:pick",
      "user:picked",
      "assistant:reading",
      "assistant:about",
      "user:about-reply",
      "assistant:understood",
      "assistant:decide:award-key",
      "user:decided:award-key",
      "assistant:assumed:share",
      "assistant:ask",
      "user:asked:q1",
      "user:asked-all",
      "assistant:preview",
      "assistant:build",
    ]);
    const parts = (id: string) => messages.find((m) => m.id === id)!.parts.slice(1);
    expect(parts("picked")).toEqual([{ type: "data-files", data: { files } }]);
    expect(parts("about-reply")).toEqual([{ type: "data-about", data: { text: "Nobel prizes" } }]);
    expect(parts("decide:award-key")).toEqual([{ type: "data-decision", data: { decision: open.decision, option: null, assumed: false } }]);
    expect(parts("decided:award-key")).toEqual([{ type: "data-decision", data: { decision: open.decision, option: "one", assumed: false } }]);
    expect(parts("assumed:share")).toEqual([{ type: "data-decision", data: { decision: assumed.decision, option: "fraction", assumed: true } }]);
    expect(parts("asked:q1")).toEqual([{ type: "data-question", data: questions[0] }]);
    expect(parts("preview")).toEqual([{ type: "data-program", data: { program: "program" } }]);
  });

  it("is opened again where it stood: the files, what it is about, the person's choices, the questions, the program", () => {
    const messages = toStored(messagesOf(turnsOf([{ ...open, chosen: "one" }, assumed]), { files, program: "program" }));
    const restored = restore(messages);
    expect(restored).toEqual({ replies: done, files, chosen: { "award-key": "one" }, questions, program: "program" });
    // Started from it, the conversation says the same turns again.
    const again = converse({ selected: picked, reading: null, decisions: [{ ...open, chosen: "one" }, assumed], questions: restored.questions }, restored.replies);
    expect(again.turns.map((t) => t.kind)).toEqual(turnsOf([{ ...open, chosen: "one" }, assumed]).map((t) => t.kind));
  });

  it("an assumption is the default's to take again, and a decision still asked is open", () => {
    expect(restore(messagesOf(turnsOf([assumed]), { files, program: null })).chosen).toEqual({});
    expect(restore(messagesOf(turnsOf([{ ...assumed, chosen: "amount" }]), { files, program: null })).chosen).toEqual({ share: "amount" });
    const asking = restore(messagesOf(turnsOf([open, assumed], { ...done, asked: false }), { files, program: null }));
    expect(asking.chosen).toEqual({});
    expect(asking.replies).toEqual({ picked: true, about: "Nobel prizes", asked: false });
  });

  it("a new conversation, or one that never sent its files, starts at the pick", () => {
    expect(restore([])).toEqual({ replies: NO_REPLIES, files: [], chosen: {}, questions: [], program: null });
    const unsent = messagesOf(converse({ selected: new Set(), reading: null, decisions: null, questions: [] }, NO_REPLIES).turns, { files: [], program: null });
    expect(restore(unsent).replies).toEqual(NO_REPLIES);
  });
});
