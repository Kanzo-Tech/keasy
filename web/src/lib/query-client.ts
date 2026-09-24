"use client";

import { QueryClient } from "@tanstack/react-query";

let redirected = false;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
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
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (status === 401) {
    redirected = true;
    window.location.href = "/api/auth/signin";
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
