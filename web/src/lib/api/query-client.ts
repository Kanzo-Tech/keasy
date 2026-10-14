import "client-only";

import { ApiError, type paths } from "@keasy/api";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@kanzo-tech/ui";

import { toastError } from "@/lib/errors";

let redirected = false;

/** A path the API answers a `GET` on: what a mutation names as a read it changed. */
export type GetPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never;
}[keyof paths];

/**
 * What a mutation says of itself, for the one place its outcome is told: a toast once it succeeds,
 * the problem said under `failure` once it fails, and the reads it changed, invalidated before it
 * settles. A mutation whose outcome is drawn in place passes none and handles itself.
 */
export type MutationMeta = {
  success?: string;
  failure?: string;
  invalidates?: readonly GetPath[];
};

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: MutationMeta;
  }
}

/** Drop every cached read under these paths, whatever its params. */
export function invalidate(...resources: readonly GetPath[]): Promise<void> {
  return Promise.all(resources.map((path) => queryClient.invalidateQueries({ queryKey: ["get", path] }))).then(
    () => undefined,
  );
}

/**
 * Every failed query and mutation passes through the caches' own `onError`, which runs beside
 * whatever the call site does. A `mutations.onError` default would not: a mutation with an
 * `onError` of its own replaces it, and an expired session read as a toast instead of a sign-in.
 */
const mutationCache = new MutationCache({
  onSuccess: async (_data, _variables, _context, mutation) => {
    const { success, invalidates = [] } = mutation.meta ?? {};
    if (success) toast.create({ title: success, type: "success" });
    await invalidate(...invalidates);
  },
  onError: (error, _variables, _context, mutation) => {
    handleAuthError(error);
    if (mutation.meta?.failure) toastError(error, mutation.meta.failure);
  },
});

/**
 * How long a read answers for itself before it is asked again: long enough that moving between
 * pages does not refetch what was just shown, short enough that another person's change appears
 * soon. A mutation invalidates what it changed, so this bounds only other people's edits.
 */
const FRESH_MS = 30_000;

// The corpora it holds are released by `releaseCorpora`, registered in `app/providers.tsx` with the
// app's failure path, which imports the API client, and the API client imports this.
const queryCache = new QueryCache({ onError: (error) => handleAuthError(error) });

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: FRESH_MS,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * A workspace the person holds no role in any more sends them home. A refused session is not
 * handled here: the BFF's own fetch signs in again when a renewal is refused.
 */
function handleAuthError(error: unknown) {
  if (redirected || !(error instanceof ApiError)) return;
  if (error.code === "rbac/no-membership") {
    redirected = true;
    window.location.href = "/";
  }
}
