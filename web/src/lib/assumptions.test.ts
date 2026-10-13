import { describe, expect, it } from "vitest";

import { decisionsOf, labelOf, programOf, taken, withDecisions, type TakenDecision } from "./assumptions";

const SHARE = {
  id: "share",
  question: "Is “share” a fraction of the prize or an amount?",
  options: [
    { id: "fraction", label: "A fraction" },
    { id: "amount", label: "An amount" },
  ],
};
const AWARD = {
  id: "award",
  question: "When two people share a Nobel, is it one award or two?",
  options: [
    { id: "one", label: "One award" },
    { id: "two", label: "Two, one per person" },
  ],
};

const PROGRAM = 'type { Person } := io.shex("@lake/people.shex")\n';

describe("the decisions a graph carries", () => {
  it("are what was taken: the person's pick over the default, nothing for one still open", () => {
    expect(
      taken([
        { decision: SHARE, assumed: "fraction", chosen: null },
        { decision: AWARD, assumed: null, chosen: "two" },
        { decision: { ...AWARD, id: "open" }, assumed: null, chosen: null },
      ]),
    ).toEqual([
      { decision: SHARE, option: "fraction", assumed: true },
      { decision: AWARD, option: "two", assumed: false },
    ]);
  });

  it("travel at the head of the program and are read back whole", () => {
    const decisions: TakenDecision[] = [
      { decision: SHARE, option: "fraction", assumed: true },
      { decision: AWARD, option: "two", assumed: false },
    ];
    const script = withDecisions(PROGRAM, decisions);
    expect(script.endsWith(PROGRAM)).toBe(true);
    expect(script.split("\n").slice(0, 2).every((line) => line.startsWith("// "))).toBe(true);
    expect(decisionsOf(script)).toEqual(decisions);
    expect(programOf(script)).toBe(PROGRAM);
    expect(labelOf(decisions[1]!)).toBe("Two, one per person");
  });

  it("are replaced, not added to, when written again", () => {
    const once = withDecisions(PROGRAM, [{ decision: SHARE, option: "fraction", assumed: true }]);
    const again = withDecisions(once, [{ decision: SHARE, option: "amount", assumed: false }]);
    expect(decisionsOf(again)).toEqual([{ decision: SHARE, option: "amount", assumed: false }]);
    expect(withDecisions(once, [])).toBe(PROGRAM);
  });

  it("are none in a program the assistant did not write, or one edited out of shape", () => {
    expect(decisionsOf(PROGRAM)).toEqual([]);
    expect(decisionsOf(null)).toEqual([]);
    expect(decisionsOf(`// keasy:decision {"option":3}\n${PROGRAM}`)).toEqual([]);
    expect(decisionsOf(`// keasy:decision {not json\n${PROGRAM}`)).toEqual([]);
  });
});
