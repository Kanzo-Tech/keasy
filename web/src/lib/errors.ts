import {
  type Code,
  CODES,
  type Foreign,
  helpUrl,
  isFossilError,
  type Related,
  type Severity,
} from "@fossil-lang/types";
import type { AuthErrorCode } from "@kanzo-tech/auth";
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
 * stopped turn, a query the engine refused, a model call that failed uncoded, and anything uncoded.
 */
export type ClientCode = "ask/stopped" | "query/failed" | "llm/failed" | "web/unknown";

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

/** keasy's words for a code, where its audience differs from the one the code was written for. */
interface Copy {
  title?: string;
  detail?: string;
  link?: { label: string; href: string };
}

const signIn = { label: "Sign in again", href: "/api/auth/signin" };

/** kanzo-ui's own failures, in the same grammar: its graph, its engine, its assisted fields. */
export type KanzoCode =
  | "graph/no-webgl"
  | "graph/context-lost"
  | "graph/nothing-to-draw"
  | "graph/untranslatable-filter"
  | "engine/unavailable"
  | "ai/silent";

const registry: Partial<Record<ErrorCode | NoBodyCode | ClientCode | Code | AuthErrorCode | KanzoCode, Copy>> = {
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
  "ask/stopped": { title: "Stopped." },
  "query/failed": {
    title: "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  "graph/no-webgl": {
    title: "This browser cannot draw the graph",
    detail: "The graph needs WebGL, which this browser or device does not offer. The dashboard still works.",
  },
  "graph/context-lost": { title: "The graph's drawing context was lost. Reload to draw it again." },
  "graph/nothing-to-draw": { title: "Nothing in this output has a position to draw." },
  "graph/untranslatable-filter": { title: "The graph cannot apply that filter." },
  "engine/unavailable": { title: "The in-browser engine would not start." },
  "storage/host-silent": { title: "keasy did not answer the data reader in time." },
  "module/unreachable": { title: "Part of the app could not be downloaded. Check the connection and retry." },
  "probe/failed": {
    title: "The store did not accept the credential.",
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

/** A cause, as the tree under a problem shows it: coded when it can be, its own words when not. */
function causeOf(cause: unknown): Shown | Foreign | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (isFossilError(cause) || cause instanceof ApiError || cause instanceof ClientError || coded(cause)) {
    return toProblem(cause);
  }
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
      : err instanceof ClientError
        ? { code: err.code, title: err.title, detail: err.message }
        : (coded(err) ??
          answered(err) ??
          streamed(err) ?? {
            code,
            title: "Something went wrong.",
            detail: err instanceof Error ? err.message : (messageOf(err) ?? String(err)),
          });
  return cause === undefined ? shown : { ...shown, cause };
}

/** The `area/kind` grammar fossil's codes follow: digits allowed after a segment's first letter (`source/not-utf8`). */
const GRAMMAR = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * An error a library coded in the shared grammar — kanzo-ui's `AuthError`, `GraphError`,
 * `EngineError`, `AiError` — keyed by its `code`, its `data` kept.
 */
function coded(err: unknown): Shown | undefined {
  if (!(err instanceof Error)) return undefined;
  const { code, data } = err as Error & { code?: unknown; data?: unknown };
  if (typeof code !== "string" || !GRAMMAR.test(code)) return undefined;
  return { code, title: copyOf(code)?.title ?? err.message, detail: err.message, data };
}

/**
 * A model call the AI SDK refused carries the server's answer as `responseBody`: when that is an
 * `ErrorBody` (`gateway/silent`, `gateway/unreachable`, …), its code is the failure's, not lost.
 */
function answered(err: unknown): Shown | undefined {
  const body = (err as { responseBody?: unknown } | null)?.responseBody;
  if (typeof body !== "string") return undefined;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; title?: unknown; detail?: unknown; data?: unknown };
    if (typeof parsed.code !== "string" || !GRAMMAR.test(parsed.code)) return undefined;
    return {
      code: parsed.code,
      title: typeof parsed.title === "string" ? parsed.title : parsed.code,
      detail: typeof parsed.detail === "string" ? parsed.detail : "",
      data: parsed.data,
    };
  } catch {
    // Not an ErrorBody: the gateway's own words, which the caller's fallback shows.
    return undefined;
  }
}

/**
 * An error event in a streamed answer, as the AI SDK hands it over: not an `Error` but the
 * protocol's `{ message, type, param, code }`, every other field dropped. keasy's relay writes one
 * when the gateway goes quiet mid-answer, coded `gateway/silent`, with its detail as `message`; a
 * provider's own (`server_error`, `429`) is not in the grammar, and stays the caller's fallback.
 */
function streamed(err: unknown): Shown | undefined {
  if (err instanceof Error || typeof err !== "object" || err === null) return undefined;
  const { code } = err as { code?: unknown };
  if (typeof code !== "string" || !GRAMMAR.test(code)) return undefined;
  const detail = messageOf(err) ?? "";
  return { code, title: copyOf(code)?.title ?? detail, detail };
}

/** The `message` a thrown non-`Error` carries, as the protocol's error objects do. */
function messageOf(err: unknown): string | undefined {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the failure's own words. */
export function toastError(error: unknown, title: string): void {
  const shown = toProblem(error);
  toast.create({ title, description: copyOf(shown.code)?.title ?? shown.detail, type: "error" });
}

/** A failure the sign-in flow reported by its code alone, as the auth error page shows it. */
export function authProblem(code: string): Shown {
  const copy = copyOf(code);
  return {
    code,
    title: copy?.title ?? "Signing in failed.",
    detail: copy?.detail ?? "The sign-in could not be completed. Start it again.",
  };
}
