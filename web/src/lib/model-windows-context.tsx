"use client";

import { createContext, useContext, useMemo } from "react";

/** Each alias's context window in tokens; an alias the platform declares none for is absent. */
export interface ModelWindows {
  chat?: number;
  complete?: number;
}

const ModelWindowsContext = createContext<ModelWindows>({});

export const ModelWindowsProvider = ModelWindowsContext.Provider;

/**
 * The `context` to hand `@kanzo-tech/ai` for an alias (`dataAgent`, `dataSuggestions`): its declared
 * window, or `undefined` when there is none, which asks nothing to narrow.
 */
export function useModelContext(alias: keyof ModelWindows): { tokens: number } | undefined {
  const tokens = useContext(ModelWindowsContext)[alias];
  // The same object while the number is, so an agent built over it is not rebuilt on every render.
  return useMemo(() => (tokens === undefined ? undefined : { tokens }), [tokens]);
}
