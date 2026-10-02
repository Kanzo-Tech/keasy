"use client";

import { AuthProvider } from "@kanzo-tech/auth";
import type { SectionManifest } from "@kanzo-tech/theme";
import { GRAPH_SECTION } from "@kanzo-tech/graph/section";
import { KanzoThemeProvider, cookieStorageAdapter, themeScript } from "@kanzo-tech/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useServerInsertedHTML } from "next/navigation";
import { queryClient } from "@/lib/api/query-client";
import { auth } from "@/lib/api/session";

/**
 * Cookie-backed rather than localStorage: `themeScript()` reads the same source before hydration,
 * so the server renders an `<html>` already carrying the chosen axes. Without the script the
 * server paints the defaults and the client re-skins on hydration.
 */
const storage = cookieStorageAdapter();
// Hoisted so the provider's resolution memo sees one identity.
const sections: SectionManifest[] = [GRAPH_SECTION];

export function Providers({ children }: { children: React.ReactNode }) {
  useServerInsertedHTML(() => (
    <script dangerouslySetInnerHTML={{ __html: themeScript() }} key="kanzo-theme-script" />
  ));

  return (
    <KanzoThemeProvider sections={sections} storage={storage}>
      <AuthProvider auth={auth}>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </AuthProvider>
    </KanzoThemeProvider>
  );
}
