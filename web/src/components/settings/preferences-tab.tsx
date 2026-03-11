"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { usePreferences } from "@/components/providers/preferences-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { FormField } from "@/components/shared/form-layout";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const FONT_OPTIONS = [
  { value: "geist", label: "Geist", css: "var(--font-geist-sans)" },
  { value: "inter", label: "Inter", css: "var(--font-inter)" },
  { value: "system", label: "System", css: "ui-sans-serif, system-ui, sans-serif" },
] as const;

const MONO_FONT_OPTIONS = [
  { value: "geist-mono", label: "Geist Mono", css: "var(--font-geist-mono)" },
  { value: "jetbrains-mono", label: "JetBrains Mono", css: "var(--font-jetbrains-mono)" },
  { value: "system", label: "System", css: "ui-monospace, SFMono-Regular, monospace" },
] as const;

const ACCENT_COLORS = [
  { value: "neutral", label: "Neutral" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
  { value: "orange", label: "Orange" },
  { value: "rose", label: "Rose" },
] as const;

const SIZE_OPTIONS = [
  { value: "compact", label: "Compact", previewSize: "1.25rem" },
  { value: "default", label: "Default", previewSize: "1.5rem" },
  { value: "comfortable", label: "Comfortable", previewSize: "1.75rem" },
] as const;

function RadioCardGroup({
  value,
  onValueChange,
  disabled,
  options,
  previewText,
  previewClassName,
  previewStyle,
}: {
  value: string;
  onValueChange: (v: string) => void;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  previewText: string;
  previewClassName?: string;
  previewStyle?: (opt: never) => React.CSSProperties;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className="grid grid-cols-3 gap-3"
    >
      {options.map((f) => (
        <Label
          key={f.value}
          htmlFor={`rc-${f.value}`}
          className={cn(
            "flex flex-col items-center gap-1 py-4 px-3 rounded-md border cursor-pointer transition-colors",
            value === f.value
              ? "border-primary bg-accent"
              : "border-border hover:bg-accent/50",
          )}
        >
          <RadioGroupItem value={f.value} id={`rc-${f.value}`} className="sr-only" />
          <span className={cn("h-8 flex items-center leading-none", previewClassName)} style={previewStyle?.(f as never)}>
            {previewText}
          </span>
          <span className="text-xs text-muted-foreground">{f.label}</span>
        </Label>
      ))}
    </RadioGroup>
  );
}

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
          <FormField label="Theme">
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
          </FormField>

          <FormField label="Accent color">
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
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Typography"
        description="Choose fonts and sizes for the interface."
      >
        <div className="space-y-4">
          <FormField label="Font">
            <RadioCardGroup
              value={preferences.font_family}
              onValueChange={(v) => handleChange("font_family", v)}
              disabled={saving}
              options={FONT_OPTIONS}
              previewText="Aa"
              previewClassName="text-2xl"
              previewStyle={(f) => ({ fontFamily: (f as { css?: string }).css })}
            />
          </FormField>

          <FormField label="Monospace font">
            <RadioCardGroup
              value={preferences.mono_font_family}
              onValueChange={(v) => handleChange("mono_font_family", v)}
              disabled={saving}
              options={MONO_FONT_OPTIONS}
              previewText="0x"
              previewClassName="text-2xl"
              previewStyle={(f) => ({ fontFamily: (f as { css?: string }).css })}
            />
          </FormField>

          <FormField label="Font size">
            <RadioCardGroup
              value={preferences.font_size}
              onValueChange={(v) => handleChange("font_size", v)}
              disabled={saving}
              options={SIZE_OPTIONS}
              previewText="aA"
              previewStyle={(f) => ({ fontSize: (f as { previewSize?: string }).previewSize })}
            />
          </FormField>
        </div>
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
