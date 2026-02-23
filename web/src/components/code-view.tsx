"use client";

import { useEffect, useRef, useState } from "react";
import { EditorView, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState, Compartment, Extension } from "@codemirror/state";
import { syntaxHighlighting, StreamLanguage } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  lightHighlight, darkHighlight,
  lightTheme, darkTheme,
  editorLayout, useIsDark,
} from "@/lib/codemirror-theme";

function sparqlLanguage() {
  return StreamLanguage.define({
    token(stream) {
      if (stream.match(/^#.*/)) return "comment";
      if (stream.match(/^"""[\s\S]*?"""/)) return "string";
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
      if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return "string";
      if (stream.match(/^<[^>]*>/)) return "string";
      if (stream.match(/^(?:SELECT|CONSTRUCT|DESCRIBE|ASK|WHERE|FILTER|OPTIONAL|UNION|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|PREFIX|BASE|BIND|AS|VALUES|DISTINCT|REDUCED|FROM|NAMED|GRAPH|SERVICE|MINUS|INSERT|DELETE|DATA|LOAD|CLEAR|DROP|CREATE|ADD|MOVE|COPY|WITH|USING|DEFAULT|ALL|SILENT|TO|INTO)\b/i)) return "keyword";
      if (stream.match(/^(?:true|false)\b/i)) return "bool";
      if (stream.match(/^(?:STR|LANG|LANGMATCHES|DATATYPE|BOUND|IRI|URI|BNODE|RAND|ABS|CEIL|FLOOR|ROUND|CONCAT|STRLEN|UCASE|LCASE|ENCODE_FOR_URI|CONTAINS|STRSTARTS|STRENDS|STRBEFORE|STRAFTER|YEAR|MONTH|DAY|HOURS|MINUTES|SECONDS|TIMEZONE|TZ|NOW|UUID|STRUUID|MD5|SHA1|SHA256|SHA384|SHA512|COALESCE|IF|STRLANG|STRDT|sameTerm|isIRI|isURI|isBLANK|isLITERAL|isNUMERIC|REGEX|SUBSTR|REPLACE|EXISTS|NOT|IN|COUNT|SUM|MIN|MAX|AVG|SAMPLE|GROUP_CONCAT|SEPARATOR)\b/i)) return "keyword";
      if (stream.match(/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
      if (stream.match(/^[?$]\w+/)) return "variableName";
      if (stream.match(/^\w+:\w*/)) return "propertyName";
      if (stream.match(/^[{}()\[\];.,]/)) return "punctuation";
      if (stream.match(/^[!=<>|&^*+\-/]+/)) return "operator";
      if (stream.match(/^[a-zA-Z_]\w*/)) return "variableName";
      stream.next();
      return null;
    },
    startState() { return {}; },
  });
}

function turtleLanguage() {
  return StreamLanguage.define({
    token(stream) {
      if (stream.match(/^#.*/)) return "comment";
      if (stream.match(/^"""[\s\S]*?"""/)) return "string";
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
      if (stream.match(/^<[^>]*>/)) return "string";
      if (stream.match(/^@(?:prefix|base)\b/i)) return "keyword";
      if (stream.match(/^(?:PREFIX|BASE)\b/i)) return "keyword";
      if (stream.match(/^(?:a)\b/)) return "keyword";
      if (stream.match(/^(?:true|false)\b/)) return "bool";
      if (stream.match(/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
      if (stream.match(/^_:\w+/)) return "variableName";
      if (stream.match(/^\w+:\w*/)) return "propertyName";
      if (stream.match(/^[;.,\[\]()]/)) return "punctuation";
      if (stream.match(/^\^\^/)) return "operator";
      if (stream.match(/^[a-zA-Z_]\w*/)) return "variableName";
      stream.next();
      return null;
    },
    startState() { return {}; },
  });
}

function getLanguageExtension(lang: string): Extension {
  switch (lang) {
    case "json":
    case "jsonld":
      return json();
    case "xml":
    case "rdf":
    case "owl":
      return xml();
    case "sparql":
      return sparqlLanguage();
    case "turtle":
    case "ttl":
    case "n3":
      return turtleLanguage();
    default:
      return [];
  }
}

interface CodeViewProps {
  code: string;
  lang: string;
  showLineNumbers?: boolean;
  showCopy?: boolean;
  className?: string;
}

export function CodeView({
  code,
  lang,
  showLineNumbers = true,
  showCopy = true,
  className,
}: CodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const isDark = useIsDark();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: code,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        drawSelection(),
        themeComp.current.of([
          isDark ? darkTheme : lightTheme,
          syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
        ]),
        langComp.current.of(getLanguageExtension(lang)),
        editorLayout,
        ...(showLineNumbers ? [lineNumbers()] : []),
      ],
    });

    viewRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  }, [code]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(getLanguageExtension(lang)),
    });
  }, [lang]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure([
        isDark ? darkTheme : lightTheme,
        syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
      ]),
    });
  }, [isDark]);

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={cn("relative rounded-md flex flex-col flex-1 min-h-0 overflow-hidden", className)}>
      {showCopy && code && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto" />
    </div>
  );
}
