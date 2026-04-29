"use client";

import { useDelayedLoading } from "@/hooks/use-delayed-loading";

/**
 * Canonical loading-state hook. Combines `useDelayedLoading` (avoid
 * skeleton flash for fast queries) with a single `showSkeleton` flag.
 *
 * Usage:
 *   const { isLoading, showSkeleton } = useSkeleton(query.isLoading);
 *   if (isLoading) return showSkeleton ? <Skeleton /> : null;
 */
export function useSkeleton(isLoading: boolean, delayMs = 150) {
  const showSkeleton = useDelayedLoading(isLoading, delayMs);
  return { isLoading, showSkeleton };
}
