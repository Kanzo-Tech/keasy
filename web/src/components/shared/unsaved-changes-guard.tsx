"use client";

import { useBeforeUnload } from "@/hooks/use-before-unload";

// Only `components/jobs` still mounts this; routes call the hook.
export function UnsavedChangesGuard({ isDirty }: { isDirty: boolean }) {
  useBeforeUnload(isDirty);
  return null;
}
