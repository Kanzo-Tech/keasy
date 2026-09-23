"use client";

import { useServerInsertedHTML } from "next/navigation";
import { themeIndex } from "@kanzo-tech/theme";
import { KanzoThemeProvider, cookieStorageAdapter, themeScript } from "@kanzo-tech/ui";

/**
 * The design system owns the theme, appearance included — there is no second writer of
 * `.dark` on `<html>` any more.
 *
 * Cookie-backed rather than localStorage: the source `themeScript()` reads before hydration
 * is the one the client writes, so the server renders an `<html>` already carrying the
 * chosen axes and the markup is identical across the boundary.
 *
 * `themeScript` is NOT optional for an SSR host. Every axis the provider applies
 * (`data-radius`, `data-font`, `data-mono-font`, `data-font-size`, `data-theme` and `.dark`)
 * lives in storage, so without it the server paints the defaults and the client re-skins on
 * hydration — a flash, plus a hydration mismatch in every control whose markup depends on
 * the resolved appearance. It goes through `useServerInsertedHTML` so Next places it in
 * `<head>` rather than the layout hand-rolling one.
 */
const storage = cookieStorageAdapter();

/** The catalogue as a control sees it: a theme carries its own mode, which the cascade
 *  already answers, so only the name reaches the panel. */
const themes = themeIndex.map((entry) => ({ value: entry.name, label: entry.name }));

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useServerInsertedHTML(() => (
    <script dangerouslySetInnerHTML={{ __html: themeScript() }} key="kanzo-theme-script" />
  ));

  return (
    <KanzoThemeProvider
      defaultTheme={{ dark: "kanzo-dark", light: "kanzo" }}
      storage={storage}
      themes={themes}
    >
      {children}
    </KanzoThemeProvider>
  );
}
