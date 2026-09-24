"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Clipboard,
  ClipboardTrigger,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  Show,
  cn,
} from "@kanzo-tech/ui";
import { CodeEditor } from "@kanzo-tech/ui/editor";
import { fossil } from "@fossil-lang/codemirror-fossil";
import { forceLinting } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { BookMarked, Database, PlugZap } from "lucide-react";
import * as checker from "@/lib/fossil/checker";
import { useSourceDescriptors } from "@/lib/fossil/use-source-descriptors";
import type { Connection } from "@/lib/types";

/** The chrome a floating cluster wears — the same utilities the canvas controls use. */
const FLOATING = "rounded-lg border bg-card shadow-sm";

const KIND_ICON = { data: Database, vocab: BookMarked } as const;
const KIND_LABEL = { data: "data source", vocab: "RDF vocabulary" } as const;

/**
 * The program, and the connections it can reference. The language layer is
 * `fossil()`'s callbacks into the checker `lib/fossil/checker.ts` holds, on the
 * main thread.
 */
export function StudioEditor({
  program,
  onProgramChange,
  connections,
  used,
  railOpen,
  onDiagnostics,
}: {
  program: string;
  onProgramChange: (program: string) => void;
  connections: Connection[];
  /** Connection names the program references — fossil's `refs()`, not a regex. */
  used: Set<string>;
  railOpen: boolean;
  onDiagnostics: (rows: readonly checker.CheckRow[]) => void;
}) {
  const view = useRef<EditorView | null>(null);
  const [booted, setBooted] = useState(false);
  const [definition, setDefinition] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void checker
      .load()
      .then(() => {
        if (alive) setBooted(true);
      })
      .catch((cause) => console.error("fossil checker failed to load", cause));
    return () => {
      alive = false;
    };
  }, []);

  // `CodeEditor` reconfigures its language on the identity of `extensions`, so
  // this is memoised; `booted` flips once, painting the buffer when wasm is up.
  const extensions = useMemo(
    () =>
      booted
        ? fossil({
            tokenize: checker.tokenize,
            tokenKinds: checker.tokenKinds,
            uri: checker.PROGRAM_URI,
            check: checker.checkText,
            onDiagnostics,
            hover: checker.hoverAt,
            complete: checker.completeAt,
            definition: checker.definitionAt,
            // One pane: a definition in a shape document is reported, not jumped to.
            onNavigate: (target) =>
              setDefinition(
                target === null
                  ? null
                  : `${target.uri}:${target.range.start.line + 1}:${target.range.start.character + 1}`,
              ),
          })
        : [],
    [booted, onDiagnostics],
  );

  // Schema-aware completion: each `@conn/path` binding is described in the
  // browser over a signed URL and pushed at the compiler before the next check.
  const descriptors = useSourceDescriptors(program, connections);
  useEffect(() => {
    if (!booted || descriptors.length === 0) return;
    for (const descriptor of descriptors) checker.registerDescriptor(descriptor);
    if (view.current) forceLinting(view.current);
  }, [booted, descriptors]);

  const insert = (connection: Connection) => {
    const v = view.current;
    if (!v) return;
    const text = connection.kind === "vocab" ? `@${connection.name}` : `@${connection.name}/`;
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    v.focus();
  };

  const pane = (
    <>
      <CodeEditor
        basics
        chrome={false}
        className="min-h-0 flex-1"
        extensions={extensions}
        lineNumbers
        onChange={onProgramChange}
        onView={(v) => {
          view.current = v;
        }}
        value={program}
      />

      <div className="absolute end-3 top-3 z-10">
        <Clipboard className={cn(FLOATING, "w-auto")} timeout={1200} value={program}>
          <ClipboardTrigger aria-label="Copy the program" />
        </Clipboard>
      </div>

      <Show when={definition !== null}>
        <div className={cn(FLOATING, "absolute bottom-3 end-3 z-10 px-2 py-1 font-mono text-xs")}>
          defined at {definition}
        </div>
      </Show>
    </>
  );

  return (
    <Show
      fallback={<div className="relative flex min-h-0 flex-1 flex-col bg-background">{pane}</div>}
      when={railOpen}
    >
      <Resizable
        className="min-h-0 flex-1"
        defaultSize={[70, 30]}
        panels={[
          { id: "editor", minSize: 40 },
          { id: "rail", minSize: 18 },
        ]}
      >
        <ResizablePanel className="flex min-w-0 flex-col overflow-hidden" id="editor">
          <div className="relative flex min-h-0 flex-1 flex-col bg-background">{pane}</div>
        </ResizablePanel>
        <ResizableResizeTrigger id="editor:rail" withHandle />
        <ResizablePanel className="flex min-h-0 min-w-0 flex-col" id="rail">
          <ShellAside aria-label="Connections" className="size-full min-h-0 border-s-0" side="end">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
              <span className="font-medium text-sm">Connections</span>
              <Badge className="ms-auto" size="xs" variant="secondary">
                {connections.length}
              </Badge>
            </div>
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
                      // The button sits inside the `Item`: `asChild` would put
                      // `role="listitem"` on it and it would stop being announced as one.
                      <Item className="p-0" key={c.id} variant="outline">
                        <button
                          className="flex w-full flex-wrap items-center gap-(--space) rounded-xl p-(--space) text-start transition-colors hover:border-primary/40"
                          onClick={() => insert(c)}
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
          </ShellAside>
        </ResizablePanel>
      </Resizable>
    </Show>
  );
}
