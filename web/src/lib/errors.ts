import { type Code, CODES, type Foreign, helpUrl, isCode, isFossilError } from "@fossil-lang/types";
import { isProblem } from "@kanzo-tech/kernel";
import { type ProblemDescription, toast } from "@kanzo-tech/ui";

import type { RefusalCode } from "@keasy/api";
import { schemaOf } from "@/lib/api/spec";
import { lower, WORDS } from "@/lib/vocabulary";

/**
 * Failures the browser names itself, in the same `area/kind` grammar as fossil's and the server's: a
 * query the engine refused, a model call that failed uncoded, a Task whose answer its oracles still
 * refused when its attempts were spent (in its own words: what it wrote and why it did not hold), a
 * graph whose files do not read as Apache GraphAr, and anything uncoded. A failure the server names too keeps the server's code
 * (`rules/refused`, rudof refusing a rules document).
 */
export type ClientCode = "query/failed" | "llm/failed" | "task/unheld" | "graph/unreadable" | "web/unknown";

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
  title?: string | ((data: unknown) => string);
  detail?: string | ((data: unknown) => string);
  link?: { label: string; href: string };
}

/** `bytes` in binary gigabytes, as a person reads a memory figure. */
function gib(bytes: number): string {
  return `${(bytes / 2 ** 30).toLocaleString("en", { maximumFractionDigits: 1 })} GiB`;
}

/** Why a failure that says so happened: `data.reason`. */
const reasonOf = (data: unknown) => (data as { reason?: unknown } | undefined)?.reason;

/**
 * The edge's sign-out, back to this host's root, which the edge turns into a sign-in: what a session
 * that ended or a token that was refused needs, since signing in over a session the edge still holds
 * would forward the same token. Under the edge's prefix (`@kanzo-tech/auth`'s default, `/api/auth`).
 */
const signIn = { label: "Sign in again", href: "/api/auth/sign_out?rd=%2F" };

/**
 * Keyed by every code there is — the server's and the kernel's registry (kanzo-ui's sign-in, graph,
 * engine and model calls), the browser's own and fossil's — so a code renamed is a type error here.
 */
const registry: Partial<Record<RefusalCode | ClientCode | Code, Copy>> = {
  "session/absent": { title: "You are signed out.", link: signIn },
  "token/refused": {
    title: "Your session has ended.",
    detail: "The identity provider ended it, after a while away or a sign-out elsewhere. Sign in again.",
    link: signIn,
  },
  "organization/denied": { title: "You are not a member of this workspace." },
  "claims/no-subject": { title: "The identity provider sent an incomplete identity." },
  "idp/silent": { title: "The identity provider did not answer in time.", link: signIn },
  "idp/unreachable": { title: "The identity provider could not be reached.", link: signIn },
  "api/unreachable": {
    title: "The server could not be reached.",
    detail: "keasy's server is not answering. Try again in a moment.",
  },
  // The model runs in the page, and cannot here: this browser has no WebGPU, or this deployment serves
  // no model (`data.reason`: `webgpu`, `unserved` — lib/ai.ts).
  "llm/unavailable": {
    title: (data) => (reasonOf(data) === "unserved" ? "This workspace has no model." : "This browser cannot run the model."),
    detail: (data) =>
      reasonOf(data) === "unserved"
        ? "Ask and the assistant run a model on this device, downloaded from keasy, and this deployment serves none. The rest of keasy works the same."
        : "Ask and the assistant run their model on this device, through WebGPU, which this browser does not offer. The rest of keasy works the same.",
  },
  "llm/failed": { title: "The model call failed. Please try again." },
  // The model answered and its context cut it off: what it wrote is not an answer, and a shorter ask
  // can be one (`data.reason` `context`, @kanzo-tech/llm).
  "llm/truncated": {
    title: "The answer was cut off.",
    detail: (data) =>
      reasonOf(data) === "context"
        ? "The model ran out of room before it finished answering, so nothing was kept. Ask about less at once, or clear the filters and ask again."
        : "The model stopped before it finished answering, so nothing was kept. Ask again.",
  },
  // `attachGraph` refused the files: the graph was built before keasy wrote Apache GraphAr, or they are damaged.
  "graph/unreadable": {
    title: "This graph's files cannot be read.",
    detail:
      "It was built before graphs were written as Apache GraphAr, or its files are damaged. A graph is read as it was built: build it again to open it.",
  },
  "query/failed": {
    title: "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  // rudof's own message places a syntax error by line and column; it is the detail.
  "rules/refused": { title: "The rules could not be read" },
  "graph/no-webgl": {
    title: "This browser cannot draw the graph",
    detail: "The graph needs WebGL, which this browser or device does not offer. The dashboard still works.",
  },
  "graph/context-lost": { title: "The graph's drawing context was lost. Reload to draw it again." },
  "graph/nothing-to-draw": { title: "Nothing in this output has a position to draw." },
  "engine/unavailable": { title: "The in-browser engine would not start." },
  "storage/host-silent": { title: "keasy did not answer the data reader in time." },
  "module/unreachable": { title: "Part of the app could not be downloaded. Check the connection and retry." },
  // The server's own title stands; keasy adds where to fix it.
  "probe/failed": { link: { label: "Go to Credentials", href: "/settings/credentials" } },
  "source/not-found": {
    title: "The source names no file",
    detail: (data) => {
      const location = (data as { location?: unknown } | undefined)?.location;
      return typeof location === "string"
        ? `Nothing was found at ${location}. Check the path and the connection it is read through.`
        : "A file the program reads was not found. Check the path and the connection it is read through.";
    },
  },
  "run/over-budget": {
    title: "Too large for the browser",
    detail: (data) => {
      const budget = (data as { budget?: unknown } | undefined)?.budget;
      const limit = typeof budget === "number" ? ` (${gib(budget)})` : "";
      return `This ${lower(WORDS.graph)} needs more memory than the browser can give it${limit}. Nothing was written — try it with less data.`;
    },
  },
};

/**
 * The codes the server owns, whose titles are its own (`server/problems.bnf`): the registry above
 * re-words none of them.
 */
const SERVER_CODES: ReadonlySet<string> = new Set(schemaOf("ServerCode").enum);

/**
 * What a failure is called: keasy's words for a code it re-words, else the server's own title for a
 * code the server owns — `undefined` for any other, whose own words are its detail.
 */
export function titleOf({ code, title, data }: { code: string; title?: string; data?: unknown }): string | undefined {
  return descriptionOf(code, data)?.title ?? (SERVER_CODES.has(code) ? title : undefined);
}

/** keasy's words for `code`, where it overrides the code's own words; `data` is the problem's. */
export function descriptionOf(code: string, data?: unknown): ProblemDescription | undefined {
  const copy = registry[code as keyof typeof registry];
  if (!copy) return undefined;
  return {
    ...copy,
    title: typeof copy.title === "function" ? copy.title(data) : copy.title,
    detail: typeof copy.detail === "function" ? copy.detail(data) : copy.detail,
  };
}

/** The page that explains `code`, for a code fossil raised; keasy's own codes have none. */
export function pageOf(code: string): string | undefined {
  return (CODES as readonly string[]).includes(code) ? helpUrl(code as Code) : undefined;
}

/**
 * A failure by the fields every coded error here shares — fossil's `FossilError`, the kernel's
 * `Problem` the server's refusals are read as, kanzo-ui's `AuthError`, `GraphError`, `EngineError` and `LlmError` — which is what
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
 * Any thrown value with a code to branch on: one that carries a code is itself — a model call's
 * `LlmError` (`llm/unavailable`) included; anything else is `uncoded`, in its own words, its cause
 * kept — a model that failed to load or to answer.
 */
export function coded(err: unknown, uncoded: ClientCode | RefusalCode = "web/unknown"): Coded {
  if (isCoded(err)) return err;
  return {
    code: uncoded,
    title: "Something went wrong.",
    message: messageOf(err) ?? String(err),
    cause: (err as { cause?: unknown } | null)?.cause,
  };
}

/** The `message` a thrown value carries, an `Error`'s or a protocol's error object's. */
function messageOf(err: unknown): string | undefined {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

/** A failure as JSON keeps it: what a failed run stores on its graph, and what a refused query hands the model. */
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
  if (!isProblem(error)) return null;
  const field = (error.data as { field?: unknown } | undefined)?.field;
  if (typeof field !== "string" || !field) return null;
  return { field, message: descriptionOf(error.code)?.title ?? error.message };
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the failure's own words. */
export function toastError(error: unknown, title: string): void {
  const problem = coded(error);
  toast.create({ title, description: titleOf(problem) ?? problem.message ?? problem.detail, type: "error" });
}
