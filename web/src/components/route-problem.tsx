"use client";

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Button } from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";

import { Failed } from "@/components/boundary";

/**
 * What a route group's `error.tsx` renders: the failure, and a retry that resets the failed queries
 * before rendering the segment again — Next's `reset` alone would re-throw the cached error.
 */
export function RouteProblem({
  error,
  reset,
  home = true,
}: {
  error: unknown;
  reset: () => void;
  home?: boolean;
}) {
  const queries = useQueryErrorResetBoundary();
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <Failed
        error={error}
        retry={() => {
          queries.reset();
          reset();
        }}
      />
      {home && (
        <Button asChild className="self-center" size="sm" variant="ghost">
          <Link href="/">Go to Dashboard</Link>
        </Button>
      )}
    </div>
  );
}
