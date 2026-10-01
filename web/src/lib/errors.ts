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

import { ApiError, type ErrorCode, type NoBodyCode } from "@/lib/api/client";

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

/**
 * Failures the browser names itself, in the same `area/kind` grammar as fossil's and the server's: a
 * stopped turn, a query the engine refused, a model answer that does not parse, and anything uncoded.
 */
export type ClientCode = "ask/stopped" | "query/failed" | "llm/unparseable" | "web/unknown";

/** keasy's words for a code, where its audience differs from the one the code was written for. */
interface Copy {
  title?: string;
  detail?: string;
  link?: { label: string; href: string };
}

const aiLink = { label: "Go to AI credentials", href: "/settings/credentials?purpose=model" };

const registry: Partial<Record<ErrorCode | NoBodyCode | ClientCode | Code, Copy>> = {
  "llm/not-configured": {
    title: "No model connection exists yet.",
    link: { label: "Add a model connection", href: "/connections?type=model" },
  },
  "llm/connection-required": { title: "Several model connections exist; pick one." },
  "llm/insufficient-credits": { title: "Your AI provider account has insufficient credits.", link: aiLink },
  "llm/failed": { title: "The model call failed. Please try again." },
  "llm/silent": { title: "The model stopped answering." },
  "llm/unparseable": { title: "The model's answer could not be read." },
  "ask/stopped": { title: "Stopped." },
  "query/failed": {
    title: "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  "probe/failed": {
    title: "The store or provider did not accept the credential.",
    link: { label: "Go to Credentials", href: "/settings/credentials" },
  },
  "resource/in-use": { title: "It is still in use." },
  "job/still-running": { title: "The job is still running; it can be deleted once it ends." },
  "job/abandoned": {
    title: "The run was abandoned",
    detail: "The tab running this job closed or lost its connection, so the job was ended. Run it again.",
  },
  "server/silent": { title: "The server did not answer in time." },
  "store/silent": { title: "The store did not answer in time." },
  "store/refused": { title: "The store refused to open the data." },
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

/** The not-found codes a page answers with Next's `notFound()`; every other failure is a problem shown. */
const NOT_FOUND = new Set<string>(["job/not-found", "connection/not-found", "credential/not-found"]);

/** Whether `err` says the resource a page is about does not exist. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && NOT_FOUND.has(err.code);
}

/** A cause, as the tree under a problem shows it: coded when it can be, its own words when not. */
function causeOf(cause: unknown): Shown | Foreign | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (isFossilError(cause) || cause instanceof ApiError) return toProblem(cause);
  if (cause instanceof Error) return { name: cause.name, detail: cause.message };
  return { name: typeof cause, detail: String(cause) };
}

/**
 * Any thrown value as a {@link Shown}: a `FossilError` is its problem, an `ApiError` the server's
 * body, and anything else is `code` (`web/unknown` by default) in its own words. A cause the thrown
 * value carries is kept, one level down.
 */
export function toProblem(err: unknown, code: ClientCode = "web/unknown"): Shown {
  if (isFossilError(err)) return err.problem;
  const cause = err instanceof Error ? causeOf(err.cause) : undefined;
  const shown: Shown =
    err instanceof ApiError
      ? { code: err.code, title: err.title, detail: err.message, data: err.data }
      : { code, title: "Something went wrong.", detail: err instanceof Error ? err.message : String(err) };
  return cause === undefined ? shown : { ...shown, cause };
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the failure's own words. */
export function toastError(error: unknown, title: string): void {
  const shown = toProblem(error);
  toast.create({ title, description: copyOf(shown.code)?.title ?? shown.detail, type: "error" });
}
