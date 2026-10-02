"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Clipboard,
  ClipboardTrigger,
  cn,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  Show,
} from "@kanzo-tech/ui";
import { CodeEditor } from "@kanzo-tech/ui/editor";
import { fossil } from "@fossil-lang/codemirror-fossil";
import { forceLinting } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { FossilProgram } from "@fossil-lang/wasm";
import * as checker from "@/lib/fossil/checker";
import { useSourceDescriptors } from "./use-source-descriptors";
import { type Shown, toProblem } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";

/** The chrome a floating cluster wears — the same utilities the canvas controls use. */
const FLOATING = "rounded-lg border bg-card shadow-sm";

/** What the inspector may do to the program. */
export interface EditorApi {
  /** Writes `text` over the selection and leaves the caret after it. */
  insert: (text: string) => void;
  /** Puts the caret at a zero-based line and character and scrolls it into view. */
  reveal: (line: number, character: number) => void;
}

/** The program, with an inspector beside it; the language layer is `fossil()` over the job's program. */
export function StudioEditor({
  program,
  onProgramChange,
  railOpen,
  onDiagnostics,
  inspector,
}: {
  program: string;
  onProgramChange: (program: string) => void;
  railOpen: boolean;
  onDiagnostics: (rows: readonly checker.CheckRow[]) => void;
  /** The rail's content, handed the function that writes at the caret. */
  inspector: (editor: EditorApi) => React.ReactNode;
}) {
  const [view, setView] = useState<EditorView | null>(null);
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
            // The rows are the program's own `check` rows, coded; the editor's type is looser.
            onDiagnostics: (rows) => onDiagnostics(rows as readonly checker.CheckRow[]),
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
  const { descriptors, undescribed, error: describeError } = useSourceDescriptors(program);
  useEffect(() => {
    if (!opened || descriptors.length === 0) return;
    for (const descriptor of descriptors) opened.registerDescriptor(descriptor);
    if (view) forceLinting(view);
  }, [opened, descriptors, view]);

  const editor = useMemo<EditorApi>(
    () => ({
      insert: (text) => {
        const v = view;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        v.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        v.focus();
      },
      reveal: (line, character) => {
        const v = view;
        if (!v) return;
        const row = v.state.doc.line(Math.min(line + 1, v.state.doc.lines));
        const anchor = Math.min(row.from + character, row.to);
        v.dispatch({
          selection: { anchor },
          effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
        v.focus();
      },
    }),
    [view],
  );

  const pane = (
    <>
      <CodeEditor
        basics
        chrome={false}
        className="min-h-0 flex-1"
        extensions={extensions}
        lineNumbers
        onChange={onProgramChange}
        onView={setView}
        value={program}
      />

      {(loadProblem || describeError || undescribed.length > 0) && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2">
          {loadProblem || describeError ? (
            <ProblemView problem={loadProblem ?? toProblem(describeError)} />
          ) : (
            // A source whose columns could not be read: completion for it is off, and this says why.
            undescribed.map(({ source, problem }) => <ProblemView key={source.key} problem={problem} />)
          )}
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
          <ShellAside aria-label="Inspector" className="size-full min-h-0 border-s-0" side="end">
            {inspector(editor)}
          </ShellAside>
        </ResizablePanel>
      </Resizable>
    </Show>
  );
}
