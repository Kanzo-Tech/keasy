"use client";

import { AuthProvider } from "@kanzo-tech/auth";
import { themeIndex, type SectionManifest } from "@kanzo-tech/theme";
import { GRAPH_SECTION } from "@kanzo-tech/graph/section";
import { KanzoThemeProvider, cookieStorageAdapter, themeScript } from "@kanzo-tech/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useServerInsertedHTML } from "next/navigation";
import { useMemo } from "react";
import { queryClient } from "@/lib/api/query-client";
import { auth } from "@/lib/api/session";
import type { Branding } from "@/lib/branding";
import { BrandingProvider } from "@/lib/branding-context";

/**
 * Cookie-backed rather than localStorage: `themeScript()` reads the same source before hydration,
 * so the server renders an `<html>` already carrying the chosen axes. Without the script the
 * server paints the defaults and the client re-skins on hydration.
 */
const storage = cookieStorageAdapter();
// Hoisted so the provider's resolution memo sees one identity.
const sections: SectionManifest[] = [GRAPH_SECTION];

export function Providers({
  branding,
  children,
}: {
  branding: Branding;
  children: React.ReactNode;
}) {
  // The instance offers the themes its operator allowed; an empty list allows every theme.
  const themes = useMemo(
    () =>
      themeIndex
        .filter((entry) => branding.themes.length === 0 || branding.themes.includes(entry.name))
        .map((entry) => ({ value: entry.name, label: entry.name })),
    [branding.themes],
  );
  const defaultTheme = useMemo(
    () => ({
      light: branding.default.light ?? "kanzo",
      dark: branding.default.dark ?? "kanzo-dark",
    }),
    [branding.default.light, branding.default.dark],
  );

  useServerInsertedHTML(() => (
    <script dangerouslySetInnerHTML={{ __html: themeScript() }} key="kanzo-theme-script" />
  ));

  return (
    <KanzoThemeProvider
      defaultTheme={defaultTheme}
      sections={sections}
      storage={storage}
      themes={themes}
    >
      <BrandingProvider value={branding}>
        <AuthProvider auth={auth}>
          <QueryClientProvider client={queryClient}>
            {children}
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </AuthProvider>
      </BrandingProvider>
    </KanzoThemeProvider>
  );
}
