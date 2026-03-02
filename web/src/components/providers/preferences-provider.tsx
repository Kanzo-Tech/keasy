"use client";

import { createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Preferences } from "@/lib/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

interface PreferencesContextValue {
  preferences: Preferences;
  saving: boolean;
  savePreferences: (prefs: Preferences) => Promise<void>;
}

const defaultPreferences: Preferences = {
  accent_color: "neutral",
  font_family: "geist",
  mono_font_family: "geist-mono",
  font_size: "default",
  mono_font_size: "default",
};

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: defaultPreferences,
  saving: false,
  savePreferences: async () => {},
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

const ATTR_MAP: { key: keyof Preferences; attr: string; defaultValue: string }[] = [
  { key: "accent_color",     attr: "data-accent",         defaultValue: "neutral" },
  { key: "font_family",      attr: "data-font",           defaultValue: "geist" },
  { key: "mono_font_family", attr: "data-mono-font",      defaultValue: "geist-mono" },
  { key: "font_size",        attr: "data-font-size",      defaultValue: "default" },
  { key: "mono_font_size",   attr: "data-mono-font-size", defaultValue: "default" },
];

function applyToDOM(prefs: Preferences) {
  const el = document.documentElement;
  for (const { key, attr, defaultValue } of ATTR_MAP) {
    if (prefs[key] === defaultValue) {
      el.removeAttribute(attr);
    } else {
      el.setAttribute(attr, prefs[key]);
    }
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data: preferences = defaultPreferences } = useQuery({
    queryKey: queryKeys.settings.preferences,
    queryFn: async () => {
      const prefs = await api.settings.preferences();
      applyToDOM(prefs);
      return prefs;
    },
  });

  const { mutateAsync, isPending } = useMutation({
    mutationFn: api.settings.savePreferences,
    onSuccess: (saved) => {
      applyToDOM(saved);
    },
  });

  async function savePreferences(prefs: Preferences) {
    await mutateAsync(prefs);
  }

  return (
    <PreferencesContext value={{ preferences, saving: isPending, savePreferences }}>
      {children}
    </PreferencesContext>
  );
}
