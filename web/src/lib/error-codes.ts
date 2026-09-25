import type { ErrorCode } from "@keasy/api";

export interface ErrorInfo {
  message: string;
  link?: { label: string; href: string };
}

/** Failures the browser names itself: a stopped run, a query DuckDB refused, an unreadable refusal. */
type ClientCode = "stopped" | "query_failed" | "unknown";

const FALLBACK: ErrorInfo = { message: "Something went wrong." };

const aiLink = { label: "Go to AI Settings", href: "/settings/ai" };

const registry: Partial<Record<ErrorCode | ClientCode, ErrorInfo>> = {
  ai_not_configured: { message: "AI settings are not configured.", link: aiLink },
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
  container_not_found: {
    message: "The specified bucket or container was not found.",
    link: { label: "Go to Cloud Accounts", href: "/settings/cloud-accounts" },
  },
};

/** UI copy for a code; a job's runtime error carries codes of its own, hence the open string. */
export function getErrorInfo(code: ErrorCode | ClientCode | (string & {})): ErrorInfo {
  return registry[code as ErrorCode | ClientCode] ?? FALLBACK;
}
