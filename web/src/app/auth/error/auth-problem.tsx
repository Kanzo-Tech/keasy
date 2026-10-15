"use client";

import { ProblemView } from "@/components/problem-view";

/**
 * The session that could not be read, by its code alone, in keasy's words where the registry has
 * them; client-side because the registry lives with the browser's errors.
 */
export function AuthProblem({ code }: { code: string }) {
  return (
    <ProblemView
      className="w-full max-w-xl"
      error={{ code, title: "Your session could not be read.", message: "Sign in again, or try again in a moment." }}
    />
  );
}
