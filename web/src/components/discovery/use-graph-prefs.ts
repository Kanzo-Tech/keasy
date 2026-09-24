"use client";

import { useMemo } from "react";
import { useKanzoTheme } from "@kanzo-tech/ui";
import { lookFrom, simFrom, type Look, type Sim } from "@kanzo-tech/graph";
import { GRAPH_SECTION } from "@kanzo-tech/graph/section";

/**
 * The graph section's resolved preferences, as the two objects `useGraph` takes.
 *
 * Exists for Kanzo-Tech/ui#2 only: `@kanzo-tech/graph` declares the manifest and ships the
 * two readers that consume it — `simFrom` and `lookFrom` both take a record keyed by the
 * manifest's own preference names — but nothing in the package joins them to the provider's
 * `sectionPrefs`. This is that join and nothing else: no defaults, no bounds, no key names.
 * Those all live in `GRAPH_SECTION`, which is the point of adopting it. Delete this file the
 * day the package exports the hook itself.
 */
export function useGraphPrefs(): { look: Look; sim: Sim } {
  const { sectionPrefs } = useKanzoTheme();
  const resolved = sectionPrefs[GRAPH_SECTION.namespace];

  return useMemo(() => {
    const values = Object.fromEntries(
      Object.entries(resolved ?? {}).map(([name, pref]) => [name, pref.value]),
    );
    return { look: lookFrom(values), sim: simFrom(values) };
  }, [resolved]);
}
