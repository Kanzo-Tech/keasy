export interface ErrorInfo {
  message: string;
  link?: { label: string; href: string };
}

const FALLBACK: ErrorInfo = { message: "Something went wrong." };

const cloudLink = { label: "Go to Cloud Accounts", href: "/settings/cloud-accounts" };

const registry: Record<string, ErrorInfo> = {
  ai_not_configured: {
    message: "AI settings are not configured.",
    link: { label: "Go to AI Settings", href: "/settings/ai" },
  },
  insufficient_credits: {
    message: "Your AI provider account has insufficient credits.",
    link: { label: "Go to AI Settings", href: "/settings/ai" },
  },
  llm_failed: {
    message: "Something went wrong generating the query. Please try again.",
  },
  parse_failed: {
    message: "Couldn't generate a valid query. Try rephrasing your question.",
  },
  sparql_failed: {
    message: "The generated query failed. Try rephrasing your question.",
  },
  cloud_error: {
    message: "Cloud storage connection failed.",
    link: cloudLink,
  },
  cloud_invalid_credentials: {
    message: "Cloud storage credentials are invalid.",
    link: cloudLink,
  },
  container_not_found: {
    message: "The specified bucket or container was not found.",
    link: cloudLink,
  },
"auth/oidc_not_configured": {
    message: "Single sign-on is not configured.",
  },
  error: FALLBACK,
  unknown: FALLBACK,
};

export function getErrorInfo(code: string): ErrorInfo {
  return registry[code] ?? FALLBACK;
}

export function isError(code: string | undefined): boolean {
  return !!code && code !== "success";
}
