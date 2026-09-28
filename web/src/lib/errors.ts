import { toast } from "@kanzo-tech/ui";

import { ApiError, type ErrorCode } from "@/lib/api/client";

interface ErrorInfo {
  message: string;
  link?: { label: string; href: string };
}

/** Failures the browser names itself: a stopped run, a query DuckDB refused, an unreadable refusal. */
type ClientCode = "stopped" | "query_failed" | "unknown";

const FALLBACK: ErrorInfo = { message: "Something went wrong." };

const aiLink = { label: "Go to AI credentials", href: "/settings/credentials?purpose=model" };

const registry: Partial<Record<ErrorCode | ClientCode, ErrorInfo>> = {
  ai_not_configured: {
    message: "No model connection exists yet.",
    link: { label: "Add a model connection", href: "/connections?type=model" },
  },
  ai_connection_required: { message: "Several model connections exist; pick one." },
  insufficient_credits: {
    message: "Your AI provider account has insufficient credits.",
    link: aiLink,
  },
  llm_failed: { message: "Something went wrong generating the query. Please try again." },
  stopped: { message: "Stopped." },
  query_failed: {
    message:
      "Query execution failed. The AI may have generated invalid SQL. Try rephrasing your question.",
  },
  probe_failed: {
    message: "The store or provider did not accept the credential.",
    link: { label: "Go to Credentials", href: "/settings/credentials" },
  },
  in_use: { message: "It is still in use." },
};

/** UI copy for a code; a job's runtime error carries codes of its own, hence the open string. */
export function getErrorInfo(code: ErrorCode | ClientCode | (string & {})): ErrorInfo {
  return registry[code as ErrorCode | ClientCode] ?? FALLBACK;
}

/** Toast a failed action: `title` names the action, the description is the code's copy or the server's words. */
export function toastError(error: unknown, title: string): void {
  const coded = error instanceof ApiError ? registry[error.code as ErrorCode] : undefined;
  toast.create({
    title,
    description: coded?.message ?? (error instanceof Error ? error.message : undefined),
    type: "error",
  });
}
