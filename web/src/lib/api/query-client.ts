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
/**
 * How long a read answers for itself before it is asked again: long enough that moving between
 * pages does not refetch what was just shown, short enough that another person's change appears
 * soon. A mutation invalidates what it changed, so this bounds only other people's edits.
 */
const FRESH_MS = 30_000;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => handleAuthError(error) }),
  mutationCache: new MutationCache({ onError: (error) => handleAuthError(error) }),
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: FRESH_MS,
      refetchOnWindowFocus: false,
    },
  },
});

/** A refused session signs in again; a workspace the person holds no role in any more sends them home. */
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
