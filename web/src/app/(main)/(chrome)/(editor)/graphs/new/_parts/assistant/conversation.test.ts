import { describe, expect, it } from "vitest";

import { toStored } from "@/lib/assistant-conversation";
import { converse, graphName, messagesOf, NO_REPLIES, placeholderOf, type Replies, restore } from "./conversation";
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
const sent: Replies = { ...NO_REPLIES, about: "" };
const kinds = (data: Parameters<typeof converse>[0], replies: Partial<Replies>) =>
  converse(data, { ...NO_REPLIES, ...replies }).turns.map((t) => t.kind);

describe("the conversation", () => {
  it("is empty until the first message — the files and what they are about — is sent, and waits on it", () => {
    const { turns, waiting } = converse({ selected: new Set(), reading: null, decisions: null, questions: [] }, NO_REPLIES);
    expect(turns).toEqual([]);
    expect(waiting).toBe("send");
  });

  it("sends the files and what they are about as one message, counted by connection, and reads them under it", () => {
    const reading = { done: 4, total: 6 };
    const at = converse({ selected: new Set([...picked, "openflights:airports.csv"]), reading, decisions: null, questions: [] }, { ...NO_REPLIES, about: "Nobel prizes" });
    expect(at.turns).toEqual([{ kind: "sent", sources: [{ connection: "nobel", files: 2 }, { connection: "openflights", files: 1 }], about: "Nobel prizes" }]);
    expect(at.waiting).toBe("reading");
  });

  it("says what is in the data, each assumption as a line, each open decision as a turn of its own, and takes questions all along", () => {
    const at = converse({ selected: picked, reading: null, decisions: [open, assumed], questions: [] }, sent);
    expect(at.turns.map((t) => t.kind)).toEqual(["sent", "understood", "assumed", "decide", "ask"]);
    // A decision with no safe answer blocks nothing: the build waits on it.
    expect(at.waiting).toBe("ask");
    expect(blocks(assumed)).toBe(false);
    expect(blocks(open)).toBe(true);
  });

  it("a chosen decision is the person's reply, kept under its turn", () => {
    const { turns } = converse({ selected: picked, reading: null, decisions: [{ ...open, chosen: "two" }, assumed], questions: [] }, sent);
    expect(turns.slice(1).map((t) => t.kind)).toEqual(["understood", "assumed", "decide", "decided", "ask"]);
  });

  it("turns to asking the data at the checkpoint, once the preview has answered, with the questions under it", () => {
    const questions = [{ id: "q1", text: "Who won twice?", answerable: true }];
    const data = { selected: picked, reading: null, decisions: [], questions };
    expect(converse(data, sent).turns.slice(-2).map((t) => t.kind)).toEqual(["ask", "asked"]);
    const { turns, waiting, closed } = converse({ ...data, previewed: true }, sent);
    expect(turns.slice(-3).map((t) => t.kind)).toEqual(["ask", "checkpoint", "asked"]);
    expect(waiting).toBe("ask");
    expect(closed).toBe(false);
  });

  it("asking for the graph is the person's message, then the build, and a built one closes the conversation", () => {
    const data = { selected: picked, reading: null, decisions: [], questions: [] };
    const asking = { ...sent, built: true };
    expect(converse(data, asking).turns.slice(-2).map((t) => t.kind)).toEqual(["build-reply", "build"]);
    // A build under way in this tab is asked for, whatever this page has replied.
    expect(kinds({ ...data, build: { state: "building", graphId: null } }, sent)).toContain("build-reply");
    expect(converse({ ...data, build: { state: "building", graphId: "g" } }, asking).closed).toBe(false);
    const done = converse({ ...data, build: { state: "done", graphId: "g" } }, asking);
    expect(done.closed).toBe(true);
    expect(done.waiting).toBeNull();
  });
});

describe("what a turn says", () => {
  it("says in the field what it takes", () => {
    expect(placeholderOf("reading", false)).toBe("Reading your files…");
    expect(placeholderOf("ask", false)).toBe("Ask anything about your data; I'll answer once the preview is ready");
    expect(placeholderOf("ask", true)).toBe("Ask anything about your data");
  });

  it("names the graph after the connections it was read through", () => {
    expect(graphName([{ connection: "Nobel laureates", path: "a.csv" }, { connection: "Nobel laureates", path: "b.csv" }])).toBe("Nobel laureates");
    expect(graphName([{ connection: "a", path: "x" }, { connection: "b", path: "y" }])).toBe("a, b");
    expect(graphName([])).toBe("New graph");
  });
});

describe("what is kept of the conversation", () => {
  const files = [
    { connection: "nobel", path: "laureates.csv" },
    { connection: "nobel", path: "awards.csv" },
  ];
  // Answered: the spec Ask read it as is kept, so it is asked again with no model; whether it answers is not.
  const spec = { of: "Laureate", show: { kind: "table", columns: ["name"] } } as never;
  const questions = [{ id: "q1", text: "Who won twice?", answerable: true, spec }];
  const done: Replies = { about: "Nobel prizes", built: false };
  const turnsOf = (decisions: DecisionItem[], replies: Replies = done) =>
    converse({ selected: picked, reading: null, decisions, questions, previewed: true }, replies).turns;

  it("is a message per turn, its kind and what the person sent, chose or typed — nothing the gate strips", () => {
    const messages = messagesOf(turnsOf([{ ...open, chosen: "one" }, assumed]), { files, program: "program" });
    expect(toStored(messages)).toEqual(messages);
    expect(messages.map((m) => `${m.role}:${m.id}`)).toEqual([
      "user:sent",
      "assistant:understood",
      "assistant:assumed:share",
      "assistant:decide:award-key",
      "user:decided:award-key",
      "assistant:ask",
      "assistant:checkpoint",
      "user:asked:q1",
    ]);
    const parts = (id: string) => messages.find((m) => m.id === id)!.parts.slice(1);
    // One message, the files and what they are about together.
    expect(parts("sent")).toEqual([
      { type: "data-files", data: { files } },
      { type: "data-about", data: { text: "Nobel prizes" } },
    ]);
    expect(parts("decide:award-key")).toEqual([{ type: "data-decision", data: { decision: open.decision, option: null, assumed: false } }]);
    expect(parts("decided:award-key")).toEqual([{ type: "data-decision", data: { decision: open.decision, option: "one", assumed: false } }]);
    expect(parts("assumed:share")).toEqual([{ type: "data-decision", data: { decision: assumed.decision, option: "fraction", assumed: true } }]);
    expect(parts("asked:q1")).toEqual([{ type: "data-question", data: { id: "q1", text: "Who won twice?", spec } }]);
    // The program written is kept on the turn that asks what the person would like to know.
    expect(parts("checkpoint")).toEqual([]);
    expect(parts("ask")).toEqual([{ type: "data-program", data: { program: "program" } }]);
  });

  it("keeps the person's message asking for the graph", () => {
    const messages = messagesOf(turnsOf([], { ...done, built: true }), { files, program: "program" });
    expect(messages.slice(-2).map((m) => `${m.role}:${m.id}`)).toEqual(["user:build-reply", "assistant:build"]);
  });

  it("is opened again where it stood: the files, what it is about, the person's choices, the questions, the program", () => {
    const messages = toStored(messagesOf(turnsOf([{ ...open, chosen: "one" }, assumed]), { files, program: "program" }));
    const restored = restore(messages);
    expect(restored).toEqual({ replies: done, files, chosen: { "award-key": "one" }, questions: [{ ...questions[0], answerable: null }], program: "program" });
    // Started from it, once the preview answers again, the conversation says the same turns again.
    const again = converse(
      { selected: picked, reading: null, decisions: [{ ...open, chosen: "one" }, assumed], questions: restored.questions, previewed: true },
      restored.replies,
    );
    expect(again.turns.map((t) => t.kind)).toEqual(turnsOf([{ ...open, chosen: "one" }, assumed]).map((t) => t.kind));
  });

  it("is not reopened mid-build: asking for the graph is not restored", () => {
    const messages = toStored(messagesOf(turnsOf([], { ...done, built: true }), { files, program: "program" }));
    expect(restore(messages).replies).toEqual(done);
  });

  it("an assumption is the default's to take again, and a decision still asked is open", () => {
    expect(restore(messagesOf(turnsOf([assumed]), { files, program: null })).chosen).toEqual({});
    expect(restore(messagesOf(turnsOf([{ ...assumed, chosen: "amount" }]), { files, program: null })).chosen).toEqual({ share: "amount" });
    expect(restore(messagesOf(turnsOf([open, assumed]), { files, program: null })).chosen).toEqual({});
  });

  it("a new conversation, or one that never sent its first message, starts at the composer", () => {
    expect(restore([])).toEqual({ replies: NO_REPLIES, files: [], chosen: {}, questions: [], program: null });
    const unsent = messagesOf(converse({ selected: new Set(), reading: null, decisions: null, questions: [] }, NO_REPLIES).turns, { files: [], program: null });
    expect(restore(unsent).replies).toEqual(NO_REPLIES);
  });
});
