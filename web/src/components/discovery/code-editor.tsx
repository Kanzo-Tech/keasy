"use client";

import { useEffect, useRef, useCallback } from "react";
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, StreamLanguage } from "@codemirror/language";
import {
  autocompletion,
  startCompletion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/formatters";
import {
  lightHighlight, darkHighlight,
  lightTheme, darkTheme,
  editorLayout, useIsDark,
} from "@/lib/codemirror-theme";
import { api } from "@/lib/api";
import type { Connection, FileEntry, FossilCompletionItem, ProviderInfo } from "@/lib/types";

function fossilLanguage() {
  return StreamLanguage.define<{ afterDot: boolean }>({
    token(stream, state) {
      if (stream.match(/^\/\/.*/)) return "comment";
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
      if (stream.match(/^#\[/)) {
        let depth = 1;
        while (depth > 0 && !stream.eol()) {
          const ch = stream.next();
          if (ch === "[") depth++;
          else if (ch === "]") depth--;
        }
        return "comment";
      }
      if (stream.match(/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+/)) return "special(string)";
      if (stream.match(/^(?:type|do|end|let|each|join|on|ref|if|else|match|fn|use|import|export|pub|mod)\b/)) return "keyword";
      if (stream.match(/^(?:true|false)\b/)) return "bool";
      if (stream.match(/^(?:string|int|float|bool)\b/)) return "typeName";
      if (stream.match(/^\w+!/)) return "keyword";
      if (stream.match(/^(?:Rdf|Report|String|Math|List|Map)\b/)) { state.afterDot = false; return "typeName"; }
      if (stream.match(/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
      if (stream.match(/^\?\?/)) return "operator";
      if (stream.match(/^\.\./)) return "operator";
      if (stream.match(/^\|>/)) return "operator";
      if (stream.match(/^\+>/)) return "operator";
      if (stream.match(/^->/)) return "operator";
      if (stream.match(/^[=<>!]+/)) return "operator";
      if (stream.eat(".")) { state.afterDot = true; return "punctuation"; }
      if (stream.match(/^[{}()\[\];,:]/)) return "punctuation";
      if (stream.match(/^\$\{/)) return "operator";
      if (stream.match(/^[A-Z]\w*/)) { state.afterDot = false; return "typeName"; }
      if (stream.match(/^[a-z_]\w*/)) {
        if (state.afterDot) { state.afterDot = false; return "propertyName"; }
        state.afterDot = false;
        return "variableName";
      }
      stream.next();
      state.afterDot = false;
      return null;
    },
    startState() { return { afterDot: false }; },
  });
}

function detectMacroContext(doc: string, pos: number, providers: ProviderInfo[]): "data" | "schema" | null {
  const before = doc.slice(0, pos);
  const match = before.match(/(\w+)!\s*\([^)]*$/);
  if (!match) return null;

  const macroName = match[1];
  const provider = providers.find((p) => p.name === macroName);
  if (!provider) return null;

  if (provider.kind === "data" || provider.kind === "both") return "data";
  if (provider.kind === "schema") return "schema";
  return null;
}

function connectionCompletion(
  connections: Connection[],
  providers: ProviderInfo[],
  fileCache: Map<string, FileEntry[]>,
) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Try path completion first: @connectionName/partialPath
    const pathMatch = context.matchBefore(/@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]*/);
    if (pathMatch) {
      const slashIdx = pathMatch.text.indexOf("/");
      const connectionName = pathMatch.text.slice(1, slashIdx);
      const pathPrefix = pathMatch.text.slice(slashIdx + 1);
      const connection = connections.find((s) => s.name === connectionName);
      if (!connection) return null;

      let files = fileCache.get(connection.id);
      if (!files) {
        try {
          files = await api.connections.files(connection.id);
          fileCache.set(connection.id, files);
        } catch {
          return null;
        }
      }

      // Filter by provider extensions based on macro context
      const macroKind = detectMacroContext(
        context.state.doc.toString(),
        context.pos,
        providers,
      );
      const supportedExts = providers
        .filter((p) => !macroKind || p.kind === macroKind || p.kind === "both")
        .flatMap((p) => p.extensions);

      const filtered = files.filter((f) => {
        const matchesPrefix = f.path.toLowerCase().includes(pathPrefix.toLowerCase());
        if (supportedExts.length === 0) return matchesPrefix;
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        return matchesPrefix && supportedExts.includes(ext);
      });

      if (filtered.length === 0) return null;

      return {
        from: pathMatch.from + slashIdx + 1,
        options: filtered.map((f) => ({
          label: f.path,
          type: "file",
          detail: formatSize(f.size),
          apply: f.path,
        })),
      };
    }

    // Connection name completion: @partialName
    const nameMatch = context.matchBefore(/@[a-zA-Z0-9_-]*/);
    if (!nameMatch) return null;

    const prefix = nameMatch.text.slice(1);

    // Filter by macro context
    const macroKind = detectMacroContext(
      context.state.doc.toString(),
      context.pos,
      providers,
    );
    const filtered = connections.filter((s) => {
      const matchesName = s.name.toLowerCase().includes(prefix.toLowerCase());
      if (!macroKind) return matchesName;
      if (macroKind === "data") return matchesName && s.kind === "data";
      if (macroKind === "schema") return matchesName && s.kind === "vocab";
      return matchesName;
    });

    if (filtered.length === 0) return null;

    return {
      from: nameMatch.from,
      options: filtered.map((s) => ({
        label: `@${s.name}`,
        type: s.kind === "data" ? "variable" : "class",
        detail: s.kind === "data" ? "Data" : "Vocabulary",
        info: s.url,
        apply: (view, _completion, from, to) => {
          const insert = `@${s.name}/`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
          setTimeout(() => startCompletion(view), 0);
        },
      })),
    };
  };
}

/** Completion source that calls the server for `row.` / `Module.` completions. */
function fossilCompletion(
  cacheRef: React.RefObject<{ source: string; receiver: string; items: FossilCompletionItem[] } | null>,
) {
  let pending: { source: string; receiver: string; promise: Promise<FossilCompletionItem[]> } | null = null;

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\w+\.\w*/);
    if (!match) return null;

    const source = context.state.doc.toString();
    const dotIdx = match.text.indexOf(".");
    const receiver = match.text.slice(0, dotIdx);
    let items: FossilCompletionItem[];

    if (cacheRef.current && cacheRef.current.source === source && cacheRef.current.receiver === receiver) {
      items = cacheRef.current.items;
    } else if (pending && pending.receiver === receiver && pending.source === source) {
      items = await pending.promise;
    } else {
      const promise = api.fossil.analyze(source, context.pos).then((r) => {
        cacheRef.current = { source, receiver, items: r.completions };
        return r.completions;
      }).finally(() => { pending = null; });
      pending = { source, receiver, promise };
      items = await promise;
    }

    if (items.length === 0) return null;

    return {
      from: match.from + dotIdx + 1,
      options: items.map((item) => ({
        label: item.label,
        type: item.kind === "field" ? "property" : item.kind === "function" ? "function" : "variable",
        detail: item.detail || undefined,
      })),
    };
  };
}

/** CodeMirror linter that calls the server for diagnostics on each change. */
function fossilLinter() {
  return linter(async (view): Promise<Diagnostic[]> => {
    const source = view.state.doc.toString();
    if (!source.trim()) return [];

    try {
      const result = await api.fossil.analyze(source, 0);
      return result.diagnostics.map((d) => ({
        from: Math.min(d.from, source.length),
        to: Math.min(d.to, source.length),
        severity: d.severity === "warning" ? "warning" as const : "error" as const,
        message: d.message,
      }));
    } catch {
      return [];
    }
  }, { delay: 500 });
}

// ── Composable Fossil extensions ────────────────────────────────────────

export { fossilLanguage };

export function fossilAutocomplete(
  connections: Connection[],
  providers: ProviderInfo[],
  fileCacheRef: React.RefObject<Map<string, FileEntry[]>>,
  completionCacheRef: React.RefObject<{ source: string; receiver: string; items: FossilCompletionItem[] } | null>,
): Extension {
  const completionSources = [
    fossilCompletion(completionCacheRef),
  ];
  if (connections.length > 0) {
    completionSources.unshift(
      connectionCompletion(connections, providers, fileCacheRef.current),
    );
  }
  return autocompletion({
    override: completionSources,
    activateOnTyping: true,
  });
}

export function fossilLinterExtension(): Extension {
  return fossilLinter();
}

// ── Generic CodeEditor ──────────────────────────────────────────────────

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  extensions?: Extension[];
  placeholder?: string;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  extensions: extraExtensions,
  placeholder,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isDark = useIsDark();

  const createExtensions = useCallback((): Extension[] => {
    const exts: Extension[] = [
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, indentWithTab]),
      isDark ? darkTheme : lightTheme,
      syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      editorLayout,
      EditorView.theme({
        ".cm-activeLineGutter": {
          backgroundColor: "oklch(var(--cm-active-bg) / 5%)",
        },
        ".cm-activeLine": {
          backgroundColor: "oklch(var(--cm-active-bg) / 5%)",
        },
      }),
    ];

    if (placeholder) {
      exts.push(cmPlaceholder(placeholder));
    }

    if (extraExtensions) {
      exts.push(...extraExtensions);
    }

    return exts;
  }, [isDark, placeholder, extraExtensions]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const state = EditorState.create({
      doc: value,
      extensions: createExtensions(),
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Only recreate on theme/sources change, not on value change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createExtensions]);

  // Sync external value changes (e.g. draft loaded after connections)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      className={cn(
        "rounded-md border relative flex-1 min-h-0 overflow-hidden",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
