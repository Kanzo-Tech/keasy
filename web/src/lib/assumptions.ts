import type { Decision } from "@kanzo-tech/ai/task";

/**
 * What the assistant decided about a graph, kept with the graph the way its program is: in the
 * program, as comments at its head. A graph carries `script`, `name` and `folder` and nothing the
 * server would hold for the web unread, so the program is the one place a decision can travel with
 * the graph without a change to the API; fossil discards comments, and the studio shows them as what
 * they are. One line per decision, its JSON whole, so Discover can say each one and offer its options
 * again:
 *
 *     // keasy:decision {"decision":{"id":"share",…},"option":"fraction","assumed":true}
 *
 * *What would reverse it:* a field for the web on a graph (opaque JSON, as its `report` is) — then the
 * decisions move there and the program is the mapping alone.
 */

/** A decision as it was taken: the person's pick, or the safe default the assistant assumed. */
export interface TakenDecision {
  decision: Decision;
  option: string;
  /** Taken without asking: a safe default, said as an assumption. */
  assumed: boolean;
}

const MARK = "// keasy:decision ";

/** The assistant's decision items as they were taken: each with an option, the person's over the default. */
export function taken(items: readonly { decision: Decision; assumed: string | null; chosen: string | null }[]): TakenDecision[] {
  return items.flatMap(({ decision, assumed, chosen }) => {
    const option = chosen ?? assumed;
    return option === null ? [] : [{ decision, option, assumed: chosen === null }];
  });
}

/** `program` with `decisions` at its head, in place of whatever decisions it carried. */
export function withDecisions(program: string, decisions: readonly TakenDecision[]): string {
  const head = decisions.map((d) => `${MARK}${JSON.stringify(d)}`);
  const body = programOf(program);
  return head.length === 0 ? body : `${head.join("\n")}\n${body}`;
}

/** The program without the decisions at its head. */
export function programOf(script: string): string {
  const lines = script.split("\n");
  let at = 0;
  while (at < lines.length && lines[at].startsWith(MARK)) at++;
  return lines.slice(at).join("\n");
}

/** The decisions at the head of `script`; a line that does not read as one is not one. */
export function decisionsOf(script: string | null | undefined): TakenDecision[] {
  const out: TakenDecision[] = [];
  for (const line of (script ?? "").split("\n")) {
    if (!line.startsWith(MARK)) break;
    try {
      const value = JSON.parse(line.slice(MARK.length)) as Partial<TakenDecision>;
      if (isTaken(value)) out.push(value);
    } catch {
      // Edited by hand into something else: not a decision.
    }
  }
  return out;
}

function isTaken(value: Partial<TakenDecision>): value is TakenDecision {
  const d = value.decision;
  return (
    typeof value.option === "string" &&
    typeof value.assumed === "boolean" &&
    !!d &&
    typeof d.id === "string" &&
    typeof d.question === "string" &&
    Array.isArray(d.options) &&
    d.options.every((o) => typeof o?.id === "string" && typeof o?.label === "string")
  );
}

/** What an option is called, by its id: its label, or the id when the decision no longer lists it. */
export function labelOf({ decision, option }: TakenDecision): string {
  return decision.options.find((o) => o.id === option)?.label ?? option;
}
