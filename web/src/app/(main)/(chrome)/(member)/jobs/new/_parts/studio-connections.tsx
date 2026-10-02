"use client";

import {
  Badge,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Show,
} from "@kanzo-tech/ui";
import { BookMarked, Database, PlugZap } from "lucide-react";
import type { StorageConnection } from "@/lib/connections";
import { type Shown } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";

const KIND_ICON = { data: Database, vocab: BookMarked } as const;
const KIND_LABEL = { data: "data source", vocab: "RDF vocabulary" } as const;

/** What a connection is to a program: a sink is where output goes, whatever its kind. */
const roleOf = (c: StorageConnection) => (c.direction === "sink" ? "output" : KIND_LABEL[c.kind]);

const reference = (c: StorageConnection) => (c.kind === "vocab" ? `@${c.name}` : `@${c.name}/`);

/**
 * The connections a program can reference — drag one into it, or click to write it at the caret —
 * and which of them it reads, marked in use.
 */
export function StudioConnections({
  connections,
  used,
  usedProblem,
  onInsert,
}: {
  connections: StorageConnection[];
  /** Connection names the program references — fossil's `refs()`, not a regex. */
  used: Set<string>;
  /** Why the program's references could not be read, so no mark is trusted. */
  usedProblem: Shown | null;
  onInsert: (text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      {usedProblem && <ProblemView problem={usedProblem} />}
      <p className="text-muted-foreground text-xs">
        Drag one into the program, click it to write it at the caret, or press @ in the editor.
      </p>
      <Show
        fallback={
          <EmptyRoot>
            <EmptyHeader>
              <EmptyIndicator variant="icon">
                <PlugZap />
              </EmptyIndicator>
              <EmptyTitle asChild>
                <h3>No connections yet</h3>
              </EmptyTitle>
              <EmptyDescription>
                A job reads through a connection. Wire one under Connections and it becomes
                referenceable as @name.
              </EmptyDescription>
            </EmptyHeader>
          </EmptyRoot>
        }
        when={connections.length > 0}
      >
        <ItemGroup className="gap-2">
          {connections.map((c) => {
            const Icon = KIND_ICON[c.kind];
            return (
              // The button sits inside the `Item`: `asChild` would put
              // `role="listitem"` on it and it would stop being announced as one.
              <Item className="p-0" key={c.name} variant="outline">
                <button
                  className="flex w-full cursor-grab flex-wrap items-center gap-(--space) rounded-xl p-(--space) text-start transition-colors hover:border-primary/40 active:cursor-grabbing"
                  draggable
                  onClick={() => onInsert(reference(c))}
                  // CodeMirror's own drop handling inserts `text/plain` at the drop cursor.
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData("text/plain", reference(c));
                  }}
                  type="button"
                >
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="font-mono">
                      @{c.name}
                      <Show when={used.has(c.name)}>
                        <Badge size="xs" variant="secondary">
                          in use
                        </Badge>
                      </Show>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-1 text-xs">{c.url}</ItemDescription>
                    <span className="text-faint text-xs">{roleOf(c)}</span>
                  </ItemContent>
                  <ItemActions>
                    <Badge size="xs" variant="outline">
                      {c.direction === "sink" ? "sink" : "source"}
                    </Badge>
                  </ItemActions>
                </button>
              </Item>
            );
          })}
        </ItemGroup>
      </Show>
    </div>
  );
}
