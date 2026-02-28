"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Preferences } from "@/lib/types";
import { fetchPreferences, savePreferences as apiSavePreferences } from "@/lib/api";

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
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPreferences()
      .then((prefs) => {
        setPreferences(prefs);
        applyToDOM(prefs);
      })
      .catch(() => {});
  }, []);

  const save = useCallback(async (prefs: Preferences) => {
    setSaving(true);
    try {
      const saved = await apiSavePreferences(prefs);
      setPreferences(saved);
      applyToDOM(saved);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <PreferencesContext value={{ preferences, saving, savePreferences: save }}>
      {children}
    </PreferencesContext>
  );
}
