import { useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#cf222e" },
  { tag: tags.string, color: "#0a3069" },
  { tag: tags.number, color: "#0550ae" },
  { tag: tags.bool, color: "#0550ae" },
  { tag: tags.null, color: "#0550ae" },
  { tag: tags.comment, color: "#6e7781", fontStyle: "italic" },
  { tag: tags.propertyName, color: "#953800" },
  { tag: tags.variableName, color: "#24292f" },
  { tag: tags.typeName, color: "#8250df" },
  { tag: tags.operator, color: "#cf222e" },
  { tag: tags.punctuation, color: "#24292f" },
  { tag: tags.meta, color: "#8250df" },
  { tag: tags.tagName, color: "#116329" },
  { tag: tags.attributeName, color: "#0550ae" },
  { tag: tags.attributeValue, color: "#0a3069" },
  { tag: tags.special(tags.string), color: "#116329" },
]);

export const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff7b72" },
  { tag: tags.string, color: "#a5d6ff" },
  { tag: tags.number, color: "#79c0ff" },
  { tag: tags.bool, color: "#79c0ff" },
  { tag: tags.null, color: "#79c0ff" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.propertyName, color: "#d2a8ff" },
  { tag: tags.variableName, color: "#e6edf3" },
  { tag: tags.typeName, color: "#f0883e" },
  { tag: tags.operator, color: "#ff7b72" },
  { tag: tags.punctuation, color: "#e6edf3" },
  { tag: tags.meta, color: "#d2a8ff" },
  { tag: tags.tagName, color: "#7ee787" },
  { tag: tags.attributeName, color: "#79c0ff" },
  { tag: tags.attributeValue, color: "#a5d6ff" },
  { tag: tags.special(tags.string), color: "#7ee787" },
]);

export const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "oklch(0.97 0 0)",
    color: "oklch(0.145 0 0)",
  },
  ".cm-gutters": {
    backgroundColor: "oklch(0.97 0 0)",
    color: "oklch(0.556 0 0 / 60%)",
    borderRight: "none",
  },
  ".cm-cursor": {
    borderLeftColor: "oklch(0.145 0 0)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "oklch(0.488 0.243 264.376 / 15%)",
  },
  ".cm-tooltip": {
    backgroundColor: "oklch(1 0 0)",
    color: "oklch(0.145 0 0)",
    border: "1px solid oklch(0.922 0 0)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "oklch(0.97 0 0)",
    color: "oklch(0.205 0 0)",
  },
  ".cm-completionDetail": {
    color: "oklch(0.556 0 0)",
  },
  ".cm-completionMatchedText": {
    color: "oklch(0.145 0 0)",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-diagnostic-error": {
    borderLeftColor: "oklch(0.577 0.245 27.325)",
  },
  ".cm-diagnostic-warning": {
    borderLeftColor: "oklch(0.768 0.165 54.13)",
  },
});

export const darkTheme = EditorView.theme({
  "&": {
    backgroundColor: "oklch(0.205 0 0)",
    color: "oklch(0.985 0 0)",
  },
  ".cm-gutters": {
    backgroundColor: "oklch(0.205 0 0)",
    color: "oklch(0.556 0 0 / 40%)",
    borderRight: "none",
  },
  ".cm-cursor": {
    borderLeftColor: "oklch(0.985 0 0)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "oklch(0.623 0.214 259.815 / 15%)",
  },
  ".cm-tooltip": {
    backgroundColor: "oklch(0.205 0 0)",
    color: "oklch(0.985 0 0)",
    border: "1px solid oklch(1 0 0 / 10%)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "oklch(0.269 0 0)",
    color: "oklch(0.985 0 0)",
  },
  ".cm-completionDetail": {
    color: "oklch(0.708 0 0)",
  },
  ".cm-completionMatchedText": {
    color: "oklch(0.985 0 0)",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-diagnostic-error": {
    borderLeftColor: "oklch(0.704 0.191 22.216)",
  },
  ".cm-diagnostic-warning": {
    borderLeftColor: "oklch(0.768 0.165 54.13)",
  },
});

export const editorLayout = EditorView.theme({
  "&": {
    fontSize: "0.75rem",
    fontFamily: "var(--font-mono)",
    height: "100%",
  },
  ".cm-content": {
    padding: "0.75rem 0",
  },
  ".cm-line": {
    padding: "0 0.75rem",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-diagnostic": {
    padding: "3px 6px 3px 8px",
    fontSize: "0.75rem",
  },
});

function getIsDark() {
  return document.documentElement.classList.contains("dark");
}

function subscribeIsDark(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useIsDark() {
  return useSyncExternalStore(subscribeIsDark, getIsDark, () => false);
}
