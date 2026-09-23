"use client";

import {
  Badge,
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
import type { Connection } from "@/lib/types";

const KIND_ICON = { data: Database, vocab: BookMarked } as const;
const KIND_LABEL = { data: "data source", vocab: "RDF vocabulary" } as const;

/**
 * What the editor needs at hand: the connections a program can reference.
 *
 * Each row is a CARD, not a line of text — it is a thing you pick up and put into
 * the program, and a flat list reads as prose you happen to be able to click.
 * `Item` in its `outline` variant is that card: a media slot for the kind, the
 * name and its URL, and the affordance in `ItemActions` where a row's controls go.
 *
 * The button is INSIDE the `Item` rather than merged with it: `Item asChild`
 * would clone `role="listitem"` onto the `<button>` and the control would stop
 * being announced as one. A listitem that CONTAINS a button is what `role="list"`
 * actually asks for.
 */
export function ConnectionsRail({
  connections,
  used,
  onInsert,
}: {
  connections: Connection[];
  /** Names the program already references — from fossil's typed lineage, not a regex. */
  used: Set<string>;
  onInsert: (connection: Connection) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <p className="text-muted-foreground text-xs">
        Click one to write it at the caret, or press @ in the editor.
      </p>

      <Show
        fallback={
          <Item className="mx-auto max-w-[420px] flex-col gap-2 py-8 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <PlugZap />
            </ItemMedia>
            <ItemTitle className="text-base">No connections yet</ItemTitle>
            <ItemDescription>
              A job reads through a connection. Wire one under Connections and it becomes
              referenceable as @name.
            </ItemDescription>
          </Item>
        }
        when={connections.length > 0}
      >
        <ItemGroup className="gap-2">
          {connections.map((c) => {
            const Icon = KIND_ICON[c.kind];
            return (
              <Item className="p-0" key={c.id} variant="outline">
                <button
                  className="flex w-full flex-wrap items-center gap-(--space) rounded-xl p-(--space) text-start transition-colors hover:border-primary/40"
                  onClick={() => onInsert(c)}
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
                    <span className="text-faint text-xs">{KIND_LABEL[c.kind]}</span>
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
