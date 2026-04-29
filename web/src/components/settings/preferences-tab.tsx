"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { usePreferences } from "@/components/providers/preferences-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { RadioCardGroup, type RadioCardOption } from "@/components/shared/radio-card-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const FONT_OPTIONS: RadioCardOption[] = [
  { value: "geist", label: "Geist", previewText: "Aa", previewClassName: "text-2xl", previewStyle: { fontFamily: "var(--font-geist-sans)" } },
  { value: "inter", label: "Inter", previewText: "Aa", previewClassName: "text-2xl", previewStyle: { fontFamily: "var(--font-inter)" } },
  { value: "system", label: "System", previewText: "Aa", previewClassName: "text-2xl", previewStyle: { fontFamily: "ui-sans-serif, system-ui, sans-serif" } },
];

const MONO_FONT_OPTIONS: RadioCardOption[] = [
  { value: "geist-mono", label: "Geist Mono", previewText: "0x", previewClassName: "text-2xl", previewStyle: { fontFamily: "var(--font-geist-mono)" } },
  { value: "jetbrains-mono", label: "JetBrains Mono", previewText: "0x", previewClassName: "text-2xl", previewStyle: { fontFamily: "var(--font-jetbrains-mono)" } },
  { value: "system", label: "System", previewText: "0x", previewClassName: "text-2xl", previewStyle: { fontFamily: "ui-monospace, SFMono-Regular, monospace" } },
];

const ACCENT_COLORS = [
  { value: "neutral", label: "Neutral" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
  { value: "orange", label: "Orange" },
  { value: "rose", label: "Rose" },
] as const;

const SIZE_OPTIONS: RadioCardOption[] = [
  { value: "compact", label: "Compact", previewText: "aA", previewStyle: { fontSize: "1.25rem" } },
  { value: "default", label: "Default", previewText: "aA", previewStyle: { fontSize: "1.5rem" } },
  { value: "comfortable", label: "Comfortable", previewText: "aA", previewStyle: { fontSize: "1.75rem" } },
];

export function PreferencesTab() {
  const { preferences, saving, savePreferences } = usePreferences();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard hydration guard for next-themes
  useEffect(() => setMounted(true), []);

  async function handleChange(key: keyof typeof preferences, value: string) {
    try {
      const updated = { ...preferences, [key]: value };
      if (key === "font_size") updated.mono_font_size = value;
      await savePreferences(updated);
    } catch {
      toast.error("Failed to save preference");
    }
  }

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Appearance"
        description="Control the look and feel of the interface."
      >
        <div className="space-y-4">
          <Field><FieldLabel>Theme</FieldLabel><FieldContent>
            <Select value={mounted ? theme : undefined} onValueChange={setTheme}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Loading..." />
              </SelectTrigger>
              <SelectContent>
                {APPEARANCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent></Field>

          <Field><FieldLabel>Accent color</FieldLabel><FieldContent>
            <Select
              value={preferences.accent_color}
              onValueChange={(v) => handleChange("accent_color", v)}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENT_COLORS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 rounded-full border"
                        style={{ backgroundColor: `var(--accent-preview-${c.value})` }}
                      />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent></Field>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Typography"
        description="Choose fonts and sizes for the interface."
      >
        <div className="space-y-4">
          <Field><FieldLabel>Font</FieldLabel><FieldContent>
            <RadioCardGroup
              name="font"
              value={preferences.font_family}
              onValueChange={(v) => handleChange("font_family", v)}
              disabled={saving}
              options={FONT_OPTIONS}
            />
          </FieldContent></Field>

          <Field><FieldLabel>Monospace font</FieldLabel><FieldContent>
            <RadioCardGroup
              name="mono-font"
              value={preferences.mono_font_family}
              onValueChange={(v) => handleChange("mono_font_family", v)}
              disabled={saving}
              options={MONO_FONT_OPTIONS}
            />
          </FieldContent></Field>

          <Field><FieldLabel>Font size</FieldLabel><FieldContent>
            <RadioCardGroup
              name="font-size"
              value={preferences.font_size}
              onValueChange={(v) => handleChange("font_size", v)}
              disabled={saving}
              options={SIZE_OPTIONS}
            />
          </FieldContent></Field>
        </div>
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
