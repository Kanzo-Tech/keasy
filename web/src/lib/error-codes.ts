export interface ErrorInfo {
  message: string;
  link?: { label: string; href: string };
}

const FALLBACK: ErrorInfo = { message: "Something went wrong." };

const cloudLink = { label: "Go to Cloud Accounts", href: "/settings/cloud-accounts" };

const registry: Record<string, ErrorInfo> = {
  AI_NOT_CONFIGURED: {
    message: "AI settings are not configured.",
    link: { label: "Go to AI Settings", href: "/settings/ai" },
  },
  LLM_FAILED: {
    message: "Something went wrong generating the query. Please try again.",
  },
  PARSE_FAILED: {
    message: "Couldn't generate a valid query. Try rephrasing your question.",
  },
  SPARQL_FAILED: {
    message: "The generated query failed. Try rephrasing your question.",
  },
  CLOUD_ERROR: {
    message: "Cloud storage connection failed.",
    link: cloudLink,
  },
  CLOUD_INVALID_CREDENTIALS: {
    message: "Cloud storage credentials are invalid.",
    link: cloudLink,
  },
  CONTAINER_NOT_FOUND: {
    message: "The specified bucket or container was not found.",
    link: cloudLink,
  },
  ERROR: FALLBACK,
  UNKNOWN: FALLBACK,
};

export function getErrorInfo(code: string): ErrorInfo {
  return registry[code] ?? FALLBACK;
}

export function isError(code: string | undefined): boolean {
  return !!code && code !== "SUCCESS";
}
