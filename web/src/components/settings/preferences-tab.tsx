"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { usePreferences } from "@/components/preferences-provider";
import { FormField } from "@/components/form-layout";
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

const SHIKI_THEMES = [
  { value: "github-dark", label: "GitHub Dark" },
  { value: "github-light", label: "GitHub Light" },
  { value: "one-dark-pro", label: "One Dark Pro" },
  { value: "dracula", label: "Dracula" },
  { value: "nord", label: "Nord" },
  { value: "min-dark", label: "Min Dark" },
  { value: "vitesse-dark", label: "Vitesse Dark" },
] as const;

const ACCENT_COLORS = [
  { value: "neutral", label: "Neutral" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "violet", label: "Violet" },
  { value: "orange", label: "Orange" },
  { value: "rose", label: "Rose" },
] as const;

const APPEARANCE_OPTIONS = [
  { value: "system", label: "System" },
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

const SIZE_OPTIONS = [
  { value: "compact", label: "Compact", previewSize: "1.25rem" },
  { value: "default", label: "Default", previewSize: "1.5rem" },
  { value: "comfortable", label: "Comfortable", previewSize: "1.75rem" },
] as const;

function RadioCardGroup({
  label,
  idPrefix,
  value,
  onValueChange,
  disabled,
  options,
  previewText,
  previewClassName,
  previewStyle,
}: {
  label: string;
  idPrefix: string;
  value: string;
  onValueChange: (v: string) => void;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  previewText: string;
  previewClassName?: string;
  previewStyle?: (opt: never) => React.CSSProperties;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        className="grid grid-cols-3 gap-3"
      >
        {options.map((f) => (
          <Label
            key={f.value}
            htmlFor={`${idPrefix}-${f.value}`}
            className={cn(
              "flex flex-col items-center gap-1 py-4 px-3 rounded-md border cursor-pointer transition-colors",
              value === f.value
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <RadioGroupItem value={f.value} id={`${idPrefix}-${f.value}`} className="sr-only" />
            <span className={cn("h-8 flex items-center leading-none", previewClassName)} style={previewStyle?.(f as never)}>
              {previewText}
            </span>
            <span className="text-xs text-muted-foreground">{f.label}</span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function PreferencesTab() {
  const { preferences, saving, savePreferences } = usePreferences();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  async function handleChange(key: keyof typeof preferences, value: string) {
    try {
      await savePreferences({ ...preferences, [key]: value });
    } catch {
      toast.error("Failed to save preference");
    }
  }

  return (
    <div className="space-y-6">
      <FormField
        label="Appearance"
        description="Choose between light and dark mode, or follow your system setting."
      >
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RadioCardGroup
          label="Font"
          idPrefix="font"
          value={preferences.font_family}
          onValueChange={(v) => handleChange("font_family", v)}
          disabled={saving}
          options={FONT_OPTIONS}
          previewText="Aa"
          previewClassName="text-2xl"
          previewStyle={(f) => ({ fontFamily: (f as { css?: string }).css })}
        />
        <RadioCardGroup
          label="Monospace Font"
          idPrefix="mono-font"
          value={preferences.mono_font_family}
          onValueChange={(v) => handleChange("mono_font_family", v)}
          disabled={saving}
          options={MONO_FONT_OPTIONS}
          previewText="0x"
          previewClassName="text-2xl"
          previewStyle={(f) => ({ fontFamily: (f as { css?: string }).css })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RadioCardGroup
          label="Font Size"
          idPrefix="font-size"
          value={preferences.font_size}
          onValueChange={(v) => handleChange("font_size", v)}
          disabled={saving}
          options={SIZE_OPTIONS}
          previewText="aA"
          previewStyle={(f) => ({ fontSize: (f as { previewSize?: string }).previewSize })}
        />
        <RadioCardGroup
          label="Monospace Font Size"
          idPrefix="mono-font-size"
          value={preferences.mono_font_size}
          onValueChange={(v) => handleChange("mono_font_size", v)}
          disabled={saving}
          options={SIZE_OPTIONS}
          previewText="0x"
          previewClassName="font-mono"
          previewStyle={(f) => ({ fontSize: (f as { previewSize?: string }).previewSize })}
        />
      </div>

      <FormField
        label="Accent Color"
        description="Choose the primary accent color for the interface."
      >
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
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: `var(--accent-preview-${c.value})` }}
                  />
                  {c.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        label="Syntax Highlight Theme"
        description="Choose the color theme used for code blocks."
      >
        <Select
          value={preferences.shiki_theme}
          onValueChange={(v) => handleChange("shiki_theme", v)}
          disabled={saving}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHIKI_THEMES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </div>
  );
}
