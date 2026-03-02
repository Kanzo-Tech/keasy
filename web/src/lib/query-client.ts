"use client";

import { QueryClient } from "@tanstack/react-query";

let redirected = false;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
    },
    mutations: {
      onError: (error: unknown) => {
        handleAuthError(error);
      },
    },
  },
});

function handleAuthError(error: unknown) {
  if (redirected) return;
  const code = (error as { code?: string })?.code;
  if (code === "auth/session_required" || code === "auth/session_expired") {
    redirected = true;
    window.location.href = "/v1/auth/oidc-start";
  } else if (code === "rbac/no_membership") {
    redirected = true;
    window.location.href = "/";
  }
}

// Global query error handler via the cache
queryClient.getQueryCache().subscribe(({ type, query }) => {
  if (type === "updated" && query.state.status === "error") {
    handleAuthError(query.state.error);
  }
});
