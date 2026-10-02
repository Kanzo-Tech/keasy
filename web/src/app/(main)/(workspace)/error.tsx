"use client";

import { ShellMain } from "@kanzo-tech/ui";

import { RouteProblem } from "@/components/route-problem";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ShellMain className="items-center justify-center p-4">
      <RouteProblem error={error} reset={reset} />
    </ShellMain>
  );
}
