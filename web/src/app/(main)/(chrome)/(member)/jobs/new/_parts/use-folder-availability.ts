"use client";

import { useEffect, useMemo, useState } from "react";
import { $api } from "@/lib/api/client";

export type Availability = "checking" | "available" | "taken";

/** Quiet before a folder as typed is asked about: one question per pause, not per keystroke. */
export const CHECK_MS = 300;

/** Calls `settle` with the last value pushed, once `ms` pass without another. */
export function debouncer<T>(ms: number, settle: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(value: T) {
      clearTimeout(timer);
      timer = setTimeout(() => settle(value), ms);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

/**
 * What the folder field says: nothing when there is nothing to ask (`asked` null) or the question
 * failed — Create's own answer decides then — checking until the asked folder has settled and been
 * answered, and the answer after.
 */
export function availabilityOf(
  asked: string | null,
  settled: string | null,
  answer: { available: boolean } | undefined,
  failed: boolean,
): Availability | null {
  if (asked === null) return null;
  if (asked !== settled) return "checking";
  if (failed) return null;
  if (!answer) return "checking";
  return answer.available ? "available" : "taken";
}

/**
 * Whether a job to run may take `folder` in `destination`, asked as the member types (GitHub's
 * repository name, Vercel's project): only a folder the contract accepts is asked about.
 */
export function useFolderAvailability(destination: string | null, folder: string, spelled: boolean) {
  // A connection's name holds no `/`, so the pair keys unambiguously.
  const asked = destination && spelled ? `${destination}/${folder}` : null;
  const [settled, setSettled] = useState<string | null>(null);
  const debounce = useMemo(() => debouncer(CHECK_MS, setSettled), []);
  useEffect(() => {
    if (asked) debounce.push(asked);
    return debounce.cancel;
  }, [asked, debounce]);

  const query = $api.useQuery(
    "get",
    "/v1/connections/{name}/folders/{folder}",
    { params: { path: { name: destination ?? "", folder } } },
    { enabled: asked !== null && asked === settled, staleTime: 0 },
  );
  return availabilityOf(asked, settled, query.data, query.isError);
}
