"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Clipboard,
  ClipboardTrigger,
  cn,
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
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  Show,
} from "@kanzo-tech/ui";
import { CodeEditor } from "@kanzo-tech/ui/editor";
import { fossil } from "@fossil-lang/codemirror-fossil";
import { forceLinting } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { BookMarked, Database, PlugZap } from "lucide-react";
import type { FossilProgram } from "@fossil-lang/wasm";
import * as checker from "@/lib/fossil/checker";
import { useSourceDescriptors } from "./use-source-descriptors";
import type { StorageConnection } from "@/lib/connections";
import { type Shown, toProblem } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";

/** The chrome a floating cluster wears — the same utilities the canvas controls use. */
const FLOATING = "rounded-lg border bg-card shadow-sm";

const KIND_ICON = { data: Database, vocab: BookMarked } as const;
const KIND_LABEL = { data: "data source", vocab: "RDF vocabulary" } as const;

/** The program, and the connections it can reference; the language layer is `fossil()` over the job's program. */
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
  connections: StorageConnection[];
  /** Connection names the program references — fossil's `refs()`, not a regex. */
  used: Set<string>;
  railOpen: boolean;
  onDiagnostics: (rows: readonly checker.CheckRow[]) => void;
}) {
  const view = useRef<EditorView | null>(null);
  const [opened, setOpened] = useState<FossilProgram | null>(null);
  const [definition, setDefinition] = useState<string | null>(null);
  const [loadProblem, setLoadProblem] = useState<Shown | null>(null);

  useEffect(() => {
    let alive = true;
    void checker
      .jobProgram()
      .then((p) => {
        if (alive) setOpened(p);
      })
      .catch((cause: unknown) => {
        if (alive) setLoadProblem(toProblem(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  // `CodeEditor` reconfigures its language on the identity of `extensions`.
  const extensions = useMemo(
    () =>
      opened
        ? fossil({
            ...opened,
            onDiagnostics,
            // One pane: a definition in a shape document is reported, not jumped to.
            onNavigate: (target) =>
              setDefinition(
                target === null
                  ? null
                  : `${target.uri}:${target.range.start.line + 1}:${target.range.start.character + 1}`,
              ),
          })
        : [],
    [opened, onDiagnostics],
  );

  // Schema-aware completion: each `@conn/path` binding is described in the
  // browser with a credential vended for its connection and pushed at the
  // compiler before the next check.
  const { descriptors, error: describeError } = useSourceDescriptors(program);
  useEffect(() => {
    if (!opened || descriptors.length === 0) return;
    for (const descriptor of descriptors) opened.registerDescriptor(descriptor);
    if (view.current) forceLinting(view.current);
  }, [opened, descriptors]);

  const insert = (connection: StorageConnection) => {
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

      {(loadProblem || describeError) && (
        <div className="absolute inset-x-3 bottom-3 z-10">
          <ProblemView problem={loadProblem ?? toProblem(describeError)} />
        </div>
      )}

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
