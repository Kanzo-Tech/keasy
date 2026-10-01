"use client";

import { ProblemView } from "@/components/problem-view";
import { authProblem } from "@/lib/errors";

/** The failed sign-in by its code; client-side because the registry lives with the browser's errors. */
export function AuthProblem({ code }: { code: string }) {
  return <ProblemView className="w-full max-w-xl" problem={authProblem(code)} />;
}
