"use client";

import { AuthProvider } from "@kanzo-tech/auth";
import { defaultThemePair, themeIndex, type SectionManifest, type ThemeOption } from "@kanzo-tech/theme";
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
import { toastError } from "@/lib/errors";
import { RELEASE_FAILED, releaseCorpora } from "@/lib/fossil/corpus-cache";

// The query cache detaches the corpora it holds; one that does not detach is said, with its code.
releaseCorpora(queryClient.getQueryCache(), { onFailure: (err) => toastError(err, RELEASE_FAILED) });

/**
 * Cookie-backed rather than localStorage: `themeScript()` reads the same source before hydration,
 * so the server renders an `<html>` already carrying the chosen axes. Without the script the
 * server paints the defaults and the client re-skins on hydration.
 */
const storage = cookieStorageAdapter();
// Hoisted so the provider's resolution memo sees one identity.
const sections: SectionManifest[] = [GRAPH_SECTION];

/**
 * The instance's branding as the theme provider takes it: the families its operator declared (every
 * shipped theme when none are), the default family's pair, and `lock`, which withdraws the choice.
 */
function themeLook(branding: Branding) {
  const themes: ThemeOption[] =
    branding.families.length === 0
      ? themeIndex
      : branding.families.flatMap(({ family, light, dark }) => [
          { ...light, dark: false, family },
          { ...dark, dark: true, family },
        ]);
  const chosen = branding.families.find((f) => f.family === branding.default);
  const defaultTheme = chosen
    ? { light: chosen.light.value, dark: chosen.dark.value }
    : defaultThemePair(themes);
  const policy = branding.lock ? { theme: { themeByAppearance: { hidden: true } } } : undefined;
  return { themes, defaultTheme, policy };
}

export function Providers({
  branding,
  children,
}: {
  branding: Branding;
  children: React.ReactNode;
}) {
  const look = useMemo(() => themeLook(branding), [branding]);

  useServerInsertedHTML(() => (
    <script
      dangerouslySetInnerHTML={{
        __html: themeScript({ defaultTheme: look.defaultTheme, policy: look.policy }),
      }}
      key="kanzo-theme-script"
    />
  ));

  return (
    <KanzoThemeProvider
      defaultTheme={look.defaultTheme}
      policy={look.policy}
      sections={sections}
      storage={storage}
      themes={look.themes}
    >
      <BrandingProvider value={branding}>
        <AuthProvider auth={auth}>
          <QueryClientProvider client={queryClient}>
            {children}
            {/* Off while `make demo` records (next.config.ts, `NEXT_PUBLIC_KEASY_DEMO`): it is not the product. */}
            {!process.env.NEXT_PUBLIC_KEASY_DEMO && <ReactQueryDevtools initialIsOpen={false} />}
          </QueryClientProvider>
        </AuthProvider>
      </BrandingProvider>
    </KanzoThemeProvider>
  );
}
