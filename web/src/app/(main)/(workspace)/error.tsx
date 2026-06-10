"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-sm font-medium text-destructive">Something went wrong</p>
        <p className="text-xs text-muted-foreground max-w-sm">{error.message}</p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={reset}>Retry</Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
