import * as z from "zod";
import { stringProblem, stringRule } from "@/lib/api/spec";

/** The server's rule for a credential's, a connection's or a graph's name, as the contract publishes it (`ResourceName`). */
const rule = stringRule("ResourceName");

export const NAME_MAX = rule.maxLength;

/** Why the server would refuse `name` as sent (trimmed; empty sends none), or `null`. */
export function nameProblem(name: string): string | null {
  const sent = name.trim();
  if (!sent) return null;
  return stringProblem(rule, sent, "A name cannot hold '/', '@', '\\' or a control character.");
}

/** A name a form requires, `empty` said when there is none: the same rule, as a form validator. */
export const requiredName = (empty: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .superRefine((name, ctx) => {
      const problem = nameProblem(name);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
