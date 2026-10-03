"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
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
import { fossil, uncheckedRow } from "@fossil-lang/codemirror-fossil";
import { forceLinting, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { X } from "lucide-react";
import type { FossilProgram } from "@fossil-lang/wasm";
import * as checker from "@/lib/fossil/checker";
import { useSourceDescriptors } from "./use-source-descriptors";

/** The chrome a floating cluster wears — the same utilities the canvas controls use. */
const FLOATING = "rounded-lg border bg-card shadow-sm";

/** What the studio around the editor may do to the program. */
export interface EditorApi {
  /** Writes `text` over the selection and leaves the caret after it. */
  insert: (text: string) => void;
  /** Puts the caret at a zero-based line and character and scrolls it into view. */
  reveal: (line: number, character: number) => void;
}

/** The program, with one panel beside it; the language layer is `fossil()` over the job's program. */
export function StudioEditor({
  program,
  onProgramChange,
  onDiagnostics,
  onEditor,
  rail,
}: {
  program: string;
  onProgramChange: (program: string) => void;
  /** Every row of the last check — the ones the editor draws — or the one row of a check that never answered. */
  onDiagnostics: (rows: readonly checker.CheckRow[]) => void;
  /** The editor's API, again whenever the view behind it changes. */
  onEditor: (editor: EditorApi) => void;
  /** The panel beside the program, under a header with its name and a close button; none, no rail. */
  rail: { label: string; onClose: () => void; content: React.ReactNode } | null;
}) {
  const [view, setView] = useState<EditorView | null>(null);
  const [opened, setOpened] = useState<FossilProgram | null>(null);
  const [definition, setDefinition] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void checker
      .jobProgram()
      .then((p) => {
        if (alive) setOpened(p);
      })
      .catch((cause: unknown) => {
        if (alive) onDiagnostics([uncheckedRow(checker.JOB_URI, cause)]);
      });
    return () => {
      alive = false;
    };
  }, [onDiagnostics]);

  // `CodeEditor` reconfigures its language on the identity of `extensions`.
  const extensions = useMemo(
    () =>
      opened
        ? [
            // The gutter is a caller's to install (`CodeEditor` themes the lint UI, ships none of it).
            lintGutter(),
            fossil({
              ...opened,
              // The rows are the program's own `check` rows, coded — a check that threw included, as
              // the one row the linter draws for it — so nothing reads "Valid" over a failed check.
              onDiagnostics: (rows) => onDiagnostics(rows as readonly checker.CheckRow[]),
              // One pane: a definition in a shape document is reported, not jumped to.
              onNavigate: (target) =>
                setDefinition(
                  target === null
                    ? null
                    : `${target.uri}:${target.range.start.line + 1}:${target.range.start.character + 1}`,
                ),
            }),
          ]
        : [],
    [opened, onDiagnostics],
  );

  // Each `@conn/path` binding is described in the browser with a credential vended for its
  // connection; fossil types the program with it and warns at each source it could not describe.
  const introspection = useSourceDescriptors(program);
  useEffect(() => {
    if (!opened || !introspection) return;
    opened.registerIntrospection(introspection);
    if (view) forceLinting(view);
  }, [opened, introspection, view]);

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
  useEffect(() => onEditor(editor), [editor, onEditor]);

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
      when={rail !== null}
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
          <ShellAside
            aria-label={`${rail?.label} panel`}
            className="size-full min-h-0 border-s-0"
            side="end"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
              <span className="font-medium text-sm">{rail?.label}</span>
              <Button
                aria-label="Close panel"
                className="-me-1 ms-auto"
                onClick={rail?.onClose}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{rail?.content}</div>
          </ShellAside>
        </ResizablePanel>
      </Resizable>
    </Show>
  );
}
