import { type Code, CODES, type Foreign, helpUrl, isCode, isFossilError } from "@fossil-lang/types";
import type { AuthErrorCode } from "@kanzo-tech/auth";
import type { GraphError } from "@kanzo-tech/graph";
import type { AiError } from "@kanzo-tech/llm";
import type { EngineError } from "@kanzo-tech/mosaic";
import { type ProblemCopy, toast } from "@kanzo-tech/ui";

import { ApiError, type ErrorCode, type NoBodyCode } from "@/lib/api/client";

/**
 * Failures the browser names itself, in the same `area/kind` grammar as fossil's and the server's: a
 * query the engine refused, a model call that failed uncoded, and anything uncoded.
 */
export type ClientCode = "query/failed" | "llm/failed" | "web/unknown";

/** A failure the browser raises itself, coded so it reaches the screen by the same path as the others. */
export class ClientError extends Error {
  constructor(
    readonly code: ClientCode,
    readonly title: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(detail, options);
    this.name = "ClientError";
  }
}

/**
 * keasy's words for a code, where its audience differs from the one the code was written for. A
 * detail that names a figure the problem carries is written from its `data`.
 */
interface Copy {
  title?: string;
  detail?: string | ((data: unknown) => string);
  link?: { label: string; href: string };
}

/** `bytes` in binary gigabytes, as a person reads a memory figure. */
function gib(bytes: number): string {
  return `${(bytes / 2 ** 30).toLocaleString("en", { maximumFractionDigits: 1 })} GiB`;
}

const signIn = { label: "Sign in again", href: "/api/auth/signin" };

/**
 * kanzo-ui's own failures, in the same grammar — its sign-in, its graph, its engine, its model
 * calls — as each library's error class declares them, so a code it renames is a type error here.
 */
type KanzoCode = AuthErrorCode | GraphError["code"] | EngineError["code"] | AiError["code"];

const registry: Partial<Record<ErrorCode | NoBodyCode | ClientCode | Code | KanzoCode, Copy>> = {
  "callback/state-mismatch": {
    title: "This sign-in could not be completed.",
    detail:
      "The sign-in was started in another tab, took too long, or was opened from the browser's history. Start it again.",
    link: signIn,
  },
  "callback/nonce-mismatch": { title: "This sign-in could not be completed.", link: signIn },
  "token/exchange-failed": { title: "The identity provider refused the sign-in.", link: signIn },
  "session/absent": { title: "You are signed out.", link: signIn },
  "organization/not-a-member": { title: "You are not a member of this workspace." },
  "organization/invalid": { title: "No such workspace." },
  "claims/no-subject": { title: "The identity provider sent an incomplete identity." },
  "session/unavailable": {
    title: "Your session could not be read.",
    detail: "The session service is not answering. Try again in a moment.",
    link: signIn,
  },
  "session/silent": { title: "Your session could not be read in time.", link: signIn },
  "idp/silent": { title: "The identity provider did not answer in time.", link: signIn },
  "idp/unreachable": { title: "The identity provider could not be reached.", link: signIn },
  "gateway/not-configured": { title: "AI is not set up for this workspace." },
  "gateway/unreachable": { title: "The AI gateway could not be reached." },
  "gateway/silent": { title: "The AI gateway did not answer in time." },
  "ai/silent": { title: "The model stopped answering." },
  "llm/failed": { title: "The model call failed. Please try again." },
  "query/failed": {
    title: "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  "graph/no-webgl": {
    title: "This browser cannot draw the graph",
    detail: "The graph needs WebGL, which this browser or device does not offer. The dashboard still works.",
  },
  "graph/context-lost": { title: "The graph's drawing context was lost. Reload to draw it again." },
  "graph/nothing-to-draw": { title: "Nothing in this output has a position to draw." },
  "graph/unfilterable": { title: "The graph cannot apply that filter." },
  "engine/unavailable": { title: "The in-browser engine would not start." },
  "storage/host-silent": { title: "keasy did not answer the data reader in time." },
  "module/unreachable": { title: "Part of the app could not be downloaded. Check the connection and retry." },
  "probe/failed": {
    title: "The store did not accept the credential.",
    link: { label: "Go to Credentials", href: "/settings/credentials" },
  },
  "resource/in-use": { title: "It is still in use." },
  "job/folder-taken": { title: "Another job writes to this folder already." },
  "job/still-running": { title: "The job is still running; it can be deleted once it ends." },
  "job/abandoned": {
    title: "The run was abandoned",
    detail: "The tab running this job closed or lost its connection, so the job was ended. Run it again.",
  },
  "server/silent": { title: "The server did not answer in time." },
  "store/silent": { title: "The store did not answer in time." },
  "store/refused": { title: "The store refused to open the data." },
  "source/not-found": {
    title: "The source names no file",
    detail: (data) => {
      const locator = (data as { locator?: unknown } | undefined)?.locator;
      return typeof locator === "string"
        ? `Nothing was found at ${locator}. Check the path and the connection it is read through.`
        : "A file the program reads was not found. Check the path and the connection it is read through.";
    },
  },
  "run/over-budget": {
    title: "Too large for the browser",
    detail: (data) => {
      const budget = (data as { budget?: unknown } | undefined)?.budget;
      const limit = typeof budget === "number" ? ` (${gib(budget)})` : "";
      return `This job needs more memory than the browser can give it${limit}. Nothing was written — try it with less data.`;
    },
  },
};

/** keasy's copy for `code`, where it overrides the code's own words; `data` is the problem's. */
export function copyOf(code: string, data?: unknown): ProblemCopy | undefined {
  const copy = registry[code as keyof typeof registry];
  if (!copy) return undefined;
  return { ...copy, detail: typeof copy.detail === "function" ? copy.detail(data) : copy.detail };
}

/** The page that explains `code`, for a code fossil raised; keasy's own codes have none. */
export function pageOf(code: string): string | undefined {
  return (CODES as readonly string[]).includes(code) ? helpUrl(code as Code) : undefined;
}

/**
 * A failure by the fields every coded error here shares — fossil's `FossilError`, the server's
 * `ApiError`, kanzo-ui's `AuthError`, `GraphError`, `EngineError` and `AiError` — which is what
 * kanzo-ui's `Problem` reads. `detail` is a stored problem's word for `message`.
 */
export interface Coded {
  code: string;
  title?: string;
  message?: string;
  detail?: string;
  data?: unknown;
  cause?: unknown;
}

const isCoded = (err: unknown): err is Coded =>
  typeof err === "object" && err !== null && isCode((err as { code?: unknown }).code);

/**
 * Any thrown value with a code to branch on: one that carries a code is itself — an AI SDK stream's
 * error event included, which keasy's relay codes `gateway/silent`; a model call the AI SDK refused
 * is the server's `ErrorBody` it holds; anything else is `uncoded`, in its own words, its cause kept.
 */
export function coded(err: unknown, uncoded: ClientCode = "web/unknown"): Coded {
  if (isCoded(err)) return err;
  return (
    answered(err) ?? {
      code: uncoded,
      title: "Something went wrong.",
      message: messageOf(err) ?? String(err),
      cause: (err as { cause?: unknown } | null)?.cause,
    }
  );
}

/**
 * A model call the AI SDK refused carries the server's answer as `responseBody`: when that is an
 * `ErrorBody` (`gateway/silent`, `gateway/unreachable`, …), its code is the failure's, not lost.
 */
function answered(err: unknown): Coded | undefined {
  const body = (err as { responseBody?: unknown } | null)?.responseBody;
  if (typeof body !== "string") return undefined;
  try {
    const parsed = JSON.parse(body) as Coded;
    return isCoded(parsed) ? parsed : undefined;
  } catch {
    // Not an ErrorBody: the gateway's own words, which the caller's fallback shows.
    return undefined;
  }
}

/** The `message` a thrown value carries, an `Error`'s or a protocol's error object's. */
function messageOf(err: unknown): string | undefined {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

/** A failure as JSON keeps it: what a failed run stores on its job, and what a refused query hands the model. */
export interface Wire {
  code: string;
  title: string;
  detail: string;
  data?: unknown;
  cause?: Wire | Foreign;
}

/**
 * A failure in its {@link Wire} form — fossil's own for a `FossilError`, the {@link coded} fields
 * otherwise — with its cause one level down, coded when it can be and in its own words when not.
 */
export function wireOf(err: unknown, uncoded?: ClientCode): Wire {
  if (isFossilError(err)) return err.problem;
  const { code, title, message, detail, data, cause } = coded(err, uncoded);
  const words = message ?? detail ?? "";
  const under =
    cause === undefined || cause === null
      ? undefined
      : isCoded(cause)
        ? wireOf(cause)
        : { name: cause instanceof Error ? cause.name : typeof cause, detail: messageOf(cause) ?? String(cause) };
  return {
    code,
    title: title ?? words,
    detail: words,
    ...(data === undefined ? {} : { data }),
    ...(under === undefined ? {} : { cause: under }),
  };
}

/** A refusal about one field of the request, as a form says it on that field. */
export interface FieldProblem {
  field: string;
  message: string;
}

/** The field a server refusal names (`data.field`) and what to say there; `null` when it names none. */
export function fieldProblem(error: unknown): FieldProblem | null {
  if (!(error instanceof ApiError)) return null;
  const field = error.data?.field;
  if (!field) return null;
  return { field, message: copyOf(error.code)?.title ?? error.message };
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the failure's own words. */
export function toastError(error: unknown, title: string): void {
  const { code, message, detail } = coded(error);
  toast.create({ title, description: copyOf(code)?.title ?? message ?? detail, type: "error" });
}
