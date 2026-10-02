import { stringProblem, stringRule } from "@/lib/api/spec";

/** The server's rule for a job's name, as the contract publishes it (`ResourceName`). */
const rule = stringRule("ResourceName");

export const NAME_MAX = rule.maxLength;

/** Why the server would refuse `name` as sent (trimmed; empty sends none), or `null`. */
export function nameProblem(name: string): string | null {
  const sent = name.trim();
  if (!sent) return null;
  return stringProblem(rule, sent, "A name cannot hold '/', '@', '\\' or a control character.");
}
