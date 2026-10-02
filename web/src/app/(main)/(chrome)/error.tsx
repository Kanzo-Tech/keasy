"use client";

import { RouteProblem } from "@/components/route-problem";

/** Inside `(chrome)/layout.tsx`'s `ShellMain`, so the page's one `<main>` stays the layout's. */
export default function ChromeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <RouteProblem error={error} reset={reset} />
    </div>
  );
}
