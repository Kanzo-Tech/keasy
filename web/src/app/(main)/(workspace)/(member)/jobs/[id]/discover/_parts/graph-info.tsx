"use client";

import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  createListCollection,
  ScrollArea,
  Show,
} from "@kanzo-tech/ui";
import { Query, useChartQuery } from "@kanzo-tech/ui/analytics";
import { column, literal, sql, verbatim } from "@uwdata/mosaic-sql";
import { GraphInspector, useGraphContext } from "@kanzo-tech/graph";
import { useCorpus } from "./corpus";

/**
 * Find one thing in the corpus and go to it: picking reveals that vertex — the canvas frames and
 * selects it with its neighbours, and the inspector below reads it. A corpus can hold millions of
 * vertices, so the matching runs in DuckDB, over every vertex table's identity, and the list is
 * capped and says so.
 */
const SEARCH_LIMIT = 50;

function CorpusSearch() {
  const { manifest, relation } = useCorpus();
  const { reveal } = useGraphContext();
  const [term, setTerm] = useState("");

  const { rows } = useChartQuery({
    filterBy: null,
    deps: [term, manifest],
    query: () => {
      const typed = term.trim();
      if (typed.length === 0) return null;
      const pattern = literal(`%${typed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      const tables = manifest.vertex_tables.map((t) => {
        const label = sql`CAST(${column(t.identity)} AS VARCHAR)`;
        return Query.from(verbatim(relation(t.name)))
          .select({ id: column(t.key), label, kind: literal(t.name) })
          .where(sql`${label} ILIKE ${pattern} ESCAPE '\\'`);
      });
      return Query.unionAll(tables).limit(SEARCH_LIMIT);
    },
  });

  const collection = useMemo(
    () =>
      createListCollection({
        items: (term.trim() ? (rows ?? []) : []).map((row) => ({
          label: String(row.label),
          value: String(row.id),
          kind: String(row.kind),
        })),
      }),
    [rows, term],
  );

  return (
    <Combobox
      collection={collection}
      onInputValueChange={(details) => setTerm(details.inputValue)}
      onValueChange={(details) => {
        const picked = details.value[0];
        if (picked !== undefined) reveal(Number(picked));
      }}
    >
      <ComboboxInput placeholder="Find anything in the graph…" size="sm" />
      <ComboboxContent>
        <ComboboxEmpty>Nothing by that name.</ComboboxEmpty>
        {collection.items.map((item) => (
          <ComboboxItem item={item} key={item.value}>
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="ms-auto ps-2 text-muted-foreground text-xs">{item.kind}</span>
          </ComboboxItem>
        ))}
        <Show when={collection.items.length >= SEARCH_LIMIT}>
          <p className="border-t px-2 py-1.5 text-muted-foreground text-xs">
            First {SEARCH_LIMIT}. Keep typing to narrow it.
          </p>
        </Show>
      </ComboboxContent>
    </Combobox>
  );
}

/** The Info panel: the search, and the package's inspector. */
export function GraphInfo() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <CorpusSearch />
      </div>
      <ScrollArea className="min-h-0 flex-1 p-3">
        <GraphInspector />
      </ScrollArea>
    </div>
  );
}
