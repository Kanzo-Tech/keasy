"use client";

import { AuthProvider, bffAuth } from "@kanzo-tech/auth";
import { themeIndex, type SectionManifest } from "@kanzo-tech/theme";
import { GRAPH_SECTION } from "@kanzo-tech/graph/section";
import { KanzoThemeProvider, cookieStorageAdapter, themeScript } from "@kanzo-tech/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useServerInsertedHTML } from "next/navigation";
import { queryClient } from "@/lib/query-client";

/**
 * `bffAuth` is the Backend-For-Frontend pattern: no PKCE, no storage, no token — a `fetch` to
 * `/api/auth/session` and a cookie it cannot read. What it yields is for drawing; the Rust
 * resource server behind `/v1` is what refuses a request.
 */
const auth = bffAuth({ basePath: "/api/auth" });

/**
 * Cookie-backed rather than localStorage: `themeScript()` reads the same source before hydration,
 * so the server renders an `<html>` already carrying the chosen axes. Without the script the
 * server paints the defaults and the client re-skins on hydration.
 */
const storage = cookieStorageAdapter();
const themes = themeIndex.map((entry) => ({ value: entry.name, label: entry.name }));
// Hoisted so the provider's resolution memo sees one identity.
const sections: SectionManifest[] = [GRAPH_SECTION];

export function Providers({ children }: { children: React.ReactNode }) {
  useServerInsertedHTML(() => (
    <script dangerouslySetInnerHTML={{ __html: themeScript() }} key="kanzo-theme-script" />
  ));

  return (
    <KanzoThemeProvider
      defaultTheme={{ dark: "kanzo-dark", light: "kanzo" }}
      sections={sections}
      storage={storage}
      themes={themes}
    >
      <AuthProvider auth={auth}>
        <QueryClientProvider client={queryClient}>
          {children}
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </AuthProvider>
    </KanzoThemeProvider>
  );
}
