"use client";

import { useBlocker } from "@kanzo-tech/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@kanzo-tech/ui";

/**
 * Asks before leaving a page with unsaved changes: an in-app link or `router.push` (through
 * `@kanzo-tech/navigation/next`), back and forward, and — in the browser's own words — reload and
 * close.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker({ shouldBlockFn: () => true, disabled: !dirty, withResolver: true });
  return (
    <AlertDialog onOpenChange={(details) => !details.open && blocker.reset?.()} open={blocker.status === "blocked"}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader description="You have unsaved changes that will be lost." title="Unsaved changes" />
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()} variant="destructive">
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
