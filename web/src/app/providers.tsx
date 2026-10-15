"use client";

import { AuthProvider } from "@kanzo-tech/auth";
import { defaultThemePair, themeIndex, type SectionManifest, type ThemeOption } from "@kanzo-tech/theme";
import { GRAPH_SECTION } from "@kanzo-tech/graph/section";
import { KanzoThemeProvider, cookieStorageAdapter, themeScript, LocaleProvider } from "@kanzo-tech/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useServerInsertedHTML } from "next/navigation";
import { useMemo } from "react";
import { queryClient } from "@/lib/api/query-client";
import { auth } from "@/lib/api/session";
import type { Branding } from "@/lib/branding";
import { BrandingProvider } from "@/lib/branding-context";
import { toastError } from "@/lib/errors";
import { LOCALE } from "@/lib/ui/format";
import { RELEASE_FAILED, releaseGraphs } from "@/lib/fossil/graph-cache";

// The query cache detaches the graphs it holds; one that does not detach is said, with its code.
releaseGraphs(queryClient.getQueryCache(), { onFailure: (err) => toastError(err, RELEASE_FAILED) });

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
        {/* The page's one query client, above everything that reads through it: the session, and the
            fields and answers kanzo-ui's Dashboard and Ask read once per page. */}
        <QueryClientProvider client={queryClient}>
          <AuthProvider auth={auth}>
            <LocaleProvider locale={LOCALE}>{children}</LocaleProvider>
          </AuthProvider>
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </BrandingProvider>
    </KanzoThemeProvider>
  );
}
