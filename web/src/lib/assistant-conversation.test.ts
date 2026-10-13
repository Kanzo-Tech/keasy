import { describe, expect, it } from "vitest";
import { changeHref, decisionsOf, labelOf, toStored } from "./assistant-conversation";

const share = {
  id: "count/affiliations",
  question: "When two laureates share an institution, is it one affiliation or two?",
  options: [
    { id: "one", label: "One, a link", detail: "e.g. Marie Curie · Sorbonne" },
    { id: "two", label: "Two, one per person" },
  ],
};

describe("what a stored conversation keeps", () => {
  it("strips every part that carries the person's data: rows, examples, counts, answers, prose", () => {
    const stored = toStored([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "data-turn", data: { kind: "understood" } },
          { type: "text", text: "Each award has a laureate, a category and a year; e.g. Marie Curie · Physics · 1903" },
          {
            type: "data-understanding",
            data: {
              things: [{ id: "laureates", name: "laureates", count: 1012, holds: ["name", "born"] }],
              relations: [{ id: "r", sentence: "Each award has…", example: ["Marie Curie", "Physics", "1903"] }],
            },
          },
          { type: "data-sample", data: { rows: [{ name: "Marie Curie", born: 1867 }] } },
          {
            type: "tool-answer",
            toolCallId: "ask-1",
            state: "output-available",
            input: {},
            output: { rows: [{ category: "Physics", count: 225 }] },
          },
          { type: "reasoning", text: "The laureates file has 1012 rows" },
          { type: "file", mediaType: "text/csv", url: "data:text/csv;base64,bmFtZQpNYXJpZQ==" },
        ],
      },
    ]);
    expect(stored).toEqual([{ id: "m1", role: "assistant", parts: [{ type: "data-turn", data: { kind: "understood" } }] }]);
    expect(JSON.stringify(stored)).not.toMatch(/Marie|1903|1012|Physics|225|bmFtZ/);
  });

  it("rebuilds each kept part from the fields it may hold, so an added field does not ride along", () => {
    const [message] = toStored([
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "data-decision", id: "d", data: { decision: share, option: "two", assumed: false, example: ["Marie Curie"] } },
          { type: "data-files", data: { files: [{ connection: "lake", path: "nobel/laureates.csv", size: 1234, head: "id,name\n1,Marie" }] } },
          { type: "data-question", data: { id: "q1", text: "Prizes by category?", answerable: true, rows: [[1]] } },
          { type: "data-program", data: { program: "use @lake/nobel/laureates.csv" } },
        ],
      },
    ]);
    expect(message.parts).toEqual([
      { type: "data-decision", id: "d", data: { decision: { ...share, options: share.options.map(({ id, label }) => ({ id, label })) }, option: "two", assumed: false } },
      { type: "data-files", data: { files: [{ connection: "lake", path: "nobel/laureates.csv" }] } },
      { type: "data-question", data: { id: "q1", text: "Prizes by category?", answerable: true } },
      { type: "data-program", data: { program: "use @lake/nobel/laureates.csv" } },
    ]);
  });

  it("keeps what the person typed, and drops what is not a message of the chat", () => {
    const stored = toStored([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Who won the most?" }] },
      { id: "s", role: "system", parts: [{ type: "text", text: "You are…" }] },
      "not a message",
      { role: "user", parts: [] },
    ]);
    expect(stored).toEqual([{ id: "u1", role: "user", parts: [{ type: "text", text: "Who won the most?" }] }]);
  });
});

describe("the decisions of a conversation", () => {
  it("are the last word on each, those still waiting left out", () => {
    const messages = toStored([
      { id: "a", role: "assistant", parts: [{ type: "data-decision", data: { decision: share, option: "one", assumed: true } }] },
      { id: "b", role: "assistant", parts: [{ type: "data-decision", data: { decision: { ...share, id: "key/x" }, option: null, assumed: false } }] },
      { id: "c", role: "user", parts: [{ type: "data-decision", data: { decision: share, option: "two", assumed: false } }] },
    ]);
    const taken = decisionsOf(messages);
    expect(taken.map((d) => [d.decision.id, d.option, d.assumed, labelOf(d)])).toEqual([["count/affiliations", "two", false, "Two, one per person"]]);
  });

  it("are changed in the assistant, at the conversation and the decision", () => {
    expect(changeHref("c 1", "count/x")).toBe("/graphs/new/assistant?conversation=c%201&decision=count%2Fx");
  });
});
