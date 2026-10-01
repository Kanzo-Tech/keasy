import {
  type Code,
  CODES,
  type Foreign,
  helpUrl,
  isFossilError,
  type Related,
  type Severity,
} from "@fossil-lang/types";
import { toast } from "@kanzo-tech/ui";

import { ApiError, type ErrorCode } from "@/lib/api/client";

/**
 * A failure as a screen shows it — one shape for fossil's `Problem`, keasy's server `ErrorBody` and
 * the failures the browser names itself: a code to branch on, a fixed title, a detail for a person
 * that nothing parses, and the data the code carries.
 */
export interface Shown {
  code: string;
  title: string;
  detail: string;
  severity?: Severity;
  help?: string;
  related?: Related[];
  cause?: Shown | Foreign;
  data?: unknown;
}

/** Failures the browser names itself: a stopped run, a query DuckDB refused, anything uncoded. */
export type ClientCode = "stopped" | "query_failed" | "unknown";

/** keasy's words for a code, where its audience differs from the one the code was written for. */
interface Copy {
  title?: string;
  detail?: string;
  link?: { label: string; href: string };
}

const aiLink = { label: "Go to AI credentials", href: "/settings/credentials?purpose=model" };

const registry: Partial<Record<ErrorCode | ClientCode | Code, Copy>> = {
  ai_not_configured: {
    title: "No model connection exists yet.",
    link: { label: "Add a model connection", href: "/connections?type=model" },
  },
  ai_connection_required: { title: "Several model connections exist; pick one." },
  insufficient_credits: { title: "Your AI provider account has insufficient credits.", link: aiLink },
  llm_failed: { title: "Something went wrong generating the query. Please try again." },
  stopped: { title: "Stopped." },
  query_failed: {
    title: "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  probe_failed: {
    title: "The store or provider did not accept the credential.",
    link: { label: "Go to Credentials", href: "/settings/credentials" },
  },
  in_use: { title: "It is still in use." },
  "run/over-budget": {
    title: "Too large for the browser",
    detail:
      "This job needs more memory than the browser can give it (2 GB). Nothing was written — try it with less data.",
  },
};

/** keasy's copy for `code`, where it overrides the code's own words. */
export function copyOf(code: string): Copy | undefined {
  return registry[code as keyof typeof registry];
}

/** The page that explains `code`, for a code fossil raised; keasy's own codes have none. */
export function pageOf(code: string): string | undefined {
  return (CODES as readonly string[]).includes(code) ? helpUrl(code as Code) : undefined;
}

/**
 * Any thrown value as a {@link Shown}: a `FossilError` is its problem, an `ApiError` the server's
 * body, and anything else is `code` (`unknown` by default) in its own words.
 */
export function toProblem(err: unknown, code: ClientCode = "unknown"): Shown {
  if (isFossilError(err)) return err.problem;
  if (err instanceof ApiError) return { code: err.code, title: err.title, detail: err.message, data: err.data };
  return { code, title: "Something went wrong.", detail: err instanceof Error ? err.message : String(err) };
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the failure's own words. */
export function toastError(error: unknown, title: string): void {
  const shown = toProblem(error);
  toast.create({ title, description: copyOf(shown.code)?.title ?? shown.detail, type: "error" });
}
