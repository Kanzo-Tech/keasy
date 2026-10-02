import "client-only";

import { ApiError } from "@keasy/api";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { auth } from "./session";

let redirected = false;

/**
 * Every failed query and mutation passes through the caches' own `onError`, which runs beside
 * whatever the call site does. A `mutations.onError` default would not: a mutation with an
 * `onError` of its own (a toast, as most have) replaces it, and an expired session read as a toast
 * instead of a sign-in.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => handleAuthError(error) }),
  mutationCache: new MutationCache({ onError: (error) => handleAuthError(error) }),
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** A refused session signs in again; a workspace the person left sends them home. */
function handleAuthError(error: unknown) {
  if (redirected || !(error instanceof ApiError)) return;
  if (error.status === 401) {
    redirected = true;
    void auth.signIn();
  } else if (error.code === "rbac/no-membership") {
    redirected = true;
    window.location.href = "/";
  }
}
