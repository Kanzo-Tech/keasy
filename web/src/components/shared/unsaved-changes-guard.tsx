"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function UnsavedChangesGuard({ isDirty }: { isDirty: boolean }) {
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

  // Browser reload / close
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Intercept history.pushState / replaceState (Next.js App Router navigation)
  useEffect(() => {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      if (isDirtyRef.current) {
        setTimeout(() => setPendingNavigation(() => () => originalPushState(...args)), 0);
        return;
      }
      originalPushState(...args);
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      if (isDirtyRef.current) {
        setTimeout(() => setPendingNavigation(() => () => originalReplaceState(...args)), 0);
        return;
      }
      originalReplaceState(...args);
    };

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  // Browser back/forward
  useEffect(() => {
    function handlePopState() {
      if (!isDirtyRef.current) return;
      // Push current state back to cancel the back navigation
      history.pushState(null, "", window.location.href);
      setPendingNavigation(() => () => history.back());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleConfirm = useCallback(() => {
    const nav = pendingNavigation;
    setPendingNavigation(null);
    // Temporarily disable guard for the replay
    isDirtyRef.current = false;
    nav?.();
  }, [pendingNavigation]);

  return (
    <AlertDialog open={pendingNavigation !== null} onOpenChange={(open) => { if (!open) setPendingNavigation(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes that will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
