"use client";

import { useEffect, useState } from "react";
import { Badge, Item, ItemContent, ItemGroup, ItemTitle, ItemDescription } from "@kanzo-tech/ui";
import { CodeEditor } from "@kanzo-tech/ui/editor";
import { refs as referencesOf, type SourceRefInfo } from "@fossil-lang/wasm";
import { lower, WORDS } from "@/lib/vocabulary";

/** The graph's recipe, read-only: the program every run runs, and the sources it reads. */
export function Recipe({ program }: { program: string }) {
  return (
    <div className="flex flex-col gap-6">
      <Sources program={program} />
      <CodeEditor lineNumbers maxHeight="70vh" readOnly value={program} />
    </div>
  );
}

/** What the program reads, as fossil's lineage names it — the parse `fossil refs` runs. */
function Sources({ program }: { program: string }) {
  const [sources, setSources] = useState<SourceRefInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    referencesOf(program).then(
      (rows) => alive && setSources(rows),
      () => alive && setSources([]),
    );
    return () => {
      alive = false;
    };
  }, [program]);
  if (!sources || sources.length === 0) return null;
  return (
    <ItemGroup aria-label={`What the ${lower(WORDS.recipe)} reads`} className="max-w-2xl">
      {sources.map((s) => (
        <Item key={`${s.connection}:${s.path}:${s.role}`} variant="outline">
          <ItemContent>
            <ItemTitle className="font-mono text-xs">
              {s.connection ? `@${s.connection}/` : ""}
              {s.path}
            </ItemTitle>
            <ItemDescription>{s.connection ? "through a connection" : "read directly"}</ItemDescription>
          </ItemContent>
          <Badge variant="secondary">{s.role}</Badge>
        </Item>
      ))}
    </ItemGroup>
  );
}
