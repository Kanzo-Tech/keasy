"use client";

import { Button, ShellMain } from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";
import { ProblemView } from "@/components/problem-view";
import { toProblem } from "@/lib/errors";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ShellMain className="items-center justify-center p-4">
      <div className="flex w-full max-w-xl flex-col gap-3">
        <ProblemView onRetry={reset} problem={toProblem(error)} retryLabel="Retry" />
        <Button asChild className="self-center" size="sm" variant="ghost">
          <Link href="/">Go to Dashboard</Link>
        </Button>
      </div>
    </ShellMain>
  );
}
