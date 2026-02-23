"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { toast } from "sonner";
import { SiAnthropic, SiOpenai } from "react-icons/si";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { fetchAiSettings, saveAiSettings } from "@/lib/api";
import { SettingsSection, SettingsPage } from "@/components/settings/settings-section";
import { FormField, FormActions } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ProviderOption {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  defaultModel: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: "anthropic", label: "Anthropic", icon: SiAnthropic, defaultModel: "claude-sonnet-4-20250514" },
  { id: "openai", label: "OpenAI", icon: SiOpenai, defaultModel: "gpt-4o" },
];

export function AiTab() {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [saving, setSaving] = useState(false);

  const [hasStoredKey, setHasStoredKey] = useState(false);

  const { data: settings, isLoading, mutate } = useSWR("ai-settings", fetchAiSettings);
  const showSkeleton = useDelayedLoading(isLoading);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider || "anthropic");
      setHasStoredKey(!!settings.api_key);
      setModel(settings.model || "");
      setMaxTokens(settings.max_tokens?.toString() || "");
    }
  }, [settings]);

  const selectedProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveAiSettings({
        provider,
        api_key: apiKey,
        model: model.trim() || undefined,
        max_tokens: maxTokens.trim() ? parseInt(maxTokens.trim(), 10) : undefined,
      });
      mutate();
      toast.success("AI settings saved");
    } catch {
      toast.error("Failed to save AI settings");
    } finally {
      setSaving(false);
    }
  }, [provider, apiKey, model, maxTokens, mutate]);

  if (isLoading) {
    return showSkeleton ? (
      <div className="space-y-6 max-w-2xl">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    ) : null;
  }

  return (
    <SettingsPage>
      <SettingsSection
        title="Provider"
        description="Select the AI provider used for data discovery features."
      >
        <RadioGroup
          value={provider}
          onValueChange={(v) => {
            setProvider(v);
            setModel("");
          }}
          className="grid grid-cols-2 gap-3"
        >
          {PROVIDERS.map((p) => (
            <Label
              key={p.id}
              htmlFor={`ai-provider-${p.id}`}
              className={cn(
                "flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors",
                provider === p.id
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <RadioGroupItem value={p.id} id={`ai-provider-${p.id}`} className="sr-only" />
              <p.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{p.label}</span>
            </Label>
          ))}
        </RadioGroup>
      </SettingsSection>

      <SettingsSection
        title="Credentials"
        description={`API key for ${selectedProvider.label}. Required for the Ask feature in data discovery.`}
      >
        <div className="space-y-3">
          <FormField label="API Key">
            <SecretInput
              hasStoredValue={hasStoredKey}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter your ${selectedProvider.label} API key`}
            />
          </FormField>
          <FormField
            label="Model"
            optional
            description={`Defaults to ${selectedProvider.defaultModel} if left empty.`}
          >
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={selectedProvider.defaultModel}
            />
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Response"
        description="Configure AI response behavior."
      >
        <FormField
          label="Max tokens"
          optional
          description="Controls AI response length. Defaults to 1024."
        >
          <Input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            placeholder="1024"
            min={1}
            max={32000}
          />
        </FormField>
      </SettingsSection>

      <FormActions sticky>
        <Button className="ml-auto" onClick={handleSave} disabled={(!apiKey.trim() && !hasStoredKey) || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </FormActions>
    </SettingsPage>
  );
}
