import "client-only";

import { ApiError } from "@keasy/api";
import { QueryClient } from "@tanstack/react-query";

import { auth } from "./session";

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

/** A refused session signs in again; a workspace the person left sends them home. */
function handleAuthError(error: unknown) {
  if (redirected || !(error instanceof ApiError)) return;
  if (error.status === 401) {
    redirected = true;
    void auth.signIn();
  } else if (error.code === "rbac/no_membership") {
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
