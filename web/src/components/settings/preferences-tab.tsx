"use client";

import {
  PreferencesColor,
  PreferencesDensity,
  PreferencesFont,
  PreferencesMonoFont,
  PreferencesRadius,
  PreferencesSections,
} from "@kanzo-tech/ui";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";

/**
 * The design system's preference sections, as a page rather than as its floating drawer.
 * Each one is wired straight to `KanzoThemeProvider` — there is no keasy state, no keasy
 * round trip and no keasy copy of the option lists.
 */
export function PreferencesTab() {
  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          title="Appearance"
          description="Control the look and feel of the interface."
        >
          <PreferencesColor />
        </SettingsSection>

        <SettingsSection
          title="Shape and density"
          description="Corner radius and the scale everything else is measured against."
        >
          <div className="space-y-4">
            <PreferencesRadius />
            <PreferencesDensity />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Typography"
          description="Choose fonts for the interface and for code."
        >
          <div className="space-y-4">
            <PreferencesFont />
            <PreferencesMonoFont />
          </div>
        </SettingsSection>

        {/* Whatever the packages this host installed contribute — nothing today, and it
            draws nothing rather than needing a guard. */}
        <PreferencesSections />
      </PageShell.Content>
    </PageShell>
  );
}
