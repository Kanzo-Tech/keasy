"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Clipboard,
  ClipboardTrigger,
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
import * as checker from "@/lib/fossil/checker";
import { useSourceDescriptors } from "@/lib/fossil/use-source-descriptors";
import { ConnectionsRail } from "@/components/jobs/connections-rail";
import type { Connection } from "@/lib/types";

/** The chrome a floating cluster wears — the same utilities the canvas controls use. */
const FLOATING = "rounded-lg border bg-card shadow-sm";


/**
 * The program, and the connections it can reference.
 *
 * Everything the editor knows comes from `@fossil-lang/codemirror-fossil`'s
 * `fossil()`, which takes plain callbacks and calls them on the main thread.
 * There is no Worker, no JSON-RPC and no transport: highlighting, squiggles,
 * hover, completion and go-to-definition are five function calls into the
 * `FossilPlayground` that `lib/fossil/checker.ts` holds. What keasy used to
 * compose — a worker entry, a `WorkerTransport`, a `<FossilEditor/>` that owned
 * its own LSP client — was the same five answers routed through a wire.
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

  // The language layer. `CodeEditor` reconfigures its `Compartment` on the
  // REFERENTIAL identity of `extensions`, so an inline array would rebuild the
  // editor's language on every render — the dependency list is load-bearing,
  // not tidiness, and `onDiagnostics` belongs in it as the stable setter it is
  // rather than as a per-render closure.
  //
  // Before the module is instantiated there is no language at all: `tokenize()`
  // would have nothing to colour with and every other callback would answer
  // about an unopened workspace. `booted` flips exactly once, and that single
  // Compartment reconfigure is what paints the buffer the moment the checker is
  // up — which is what the `wasmReady` gate bought by refusing to render the
  // editor, except the program stays readable and typeable while wasm loads.
  //
  // Nothing here debounces. `fossil()`'s linter waits out its own delay and then
  // waits for the check to return before scheduling the next one, so the
  // coalescing an LSP client does with `didChange` is in the library.
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
            // One pane, so a definition in a shape document cannot be a jump.
            // Reporting where it is beats moving the cursor to the same
            // coordinates in the wrong buffer, which is what a host that
            // ignored `uri` would do.
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

  // Schema-aware completion: each `@conn/path` binding is introspected through
  // keasy's server (which holds the org's credentials) and pushed at the
  // compiler before the next check. Registering used to travel over the worker
  // as `fossil/registerInferredDescriptor`; it is a method call now.
  const descriptors = useSourceDescriptors(program, connections);
  useEffect(() => {
    if (!booted || descriptors.length === 0) return;
    for (const descriptor of descriptors) checker.registerDescriptor(descriptor);
    // The descriptor is a Salsa input: re-check so the columns it declares stop
    // being unknown. `forceLinting` is how CodeMirror asks for that without
    // faking a document change.
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
      {/* `chrome={false}`: an editor PANE, not a form field — the focus ring and
          rounded border belong to a control sitting in a form, and here the
          region's own borders do that job. `basics` stays on, so the theme,
          history and keymap come from the library and only the language is ours
          (which keasy used to hand-roll). */}
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

      {/* Top-end, which is where an editor's own actions go. Ark's machine owns
          the copied→check flip, so the only thing this call site decides is what
          gets copied. */}
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
            <ConnectionsRail connections={connections} onInsert={insert} used={used} />
          </ShellAside>
        </ResizablePanel>
      </Resizable>
    </Show>
  );
}
