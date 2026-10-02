"use client";

import { ProblemView } from "@/components/problem-view";

/**
 * The failed sign-in by its code alone, in keasy's words where the registry has them; client-side
 * because the registry lives with the browser's errors.
 */
export function AuthProblem({ code }: { code: string }) {
  return (
    <ProblemView
      className="w-full max-w-xl"
      error={{ code, title: "Signing in failed.", message: "The sign-in could not be completed. Start it again." }}
    />
  );
}
