"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { fetchAiProviders, saveAiProvider, deleteAiProvider } from "@/lib/api";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";
import { FormField, FormActions } from "@/components/shared/form-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AiSettings } from "@/lib/types";

function ProviderPanel({
  provider,
  saved,
  onSaved,
}: {
  provider: (typeof AI_PROVIDERS)[number];
  saved: AiSettings | undefined;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(saved?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(saved?.max_tokens?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const isConnected = !!saved?.api_key;
  const hasStoredKey = isConnected;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveAiProvider(provider.id, {
        api_key: apiKey,
        model: model.trim() || undefined,
        max_tokens: maxTokens.trim() ? parseInt(maxTokens.trim(), 10) : undefined,
      });
      setApiKey("");
      onSaved();
      toast.success(`${provider.label} settings saved`);
    } catch {
      toast.error(`Failed to save ${provider.label} settings`);
    } finally {
      setSaving(false);
    }
  }, [provider, apiKey, model, maxTokens, onSaved]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await deleteAiProvider(provider.id);
      setApiKey("");
      setModel("");
      setMaxTokens("");
      onSaved();
      toast.success(`${provider.label} removed`);
    } catch {
      toast.error(`Failed to remove ${provider.label}`);
    } finally {
      setRemoving(false);
    }
  }, [provider, onSaved]);

  return (
    <>
      <div className="space-y-3">
        <FormField label="API Key">
          <SecretInput
            hasStoredValue={hasStoredKey}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Enter your ${provider.label} API key`}
          />
        </FormField>
        <FormField
          label="Model"
          optional
          description={`Defaults to ${provider.defaultModel} if left empty.`}
        >
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={provider.defaultModel}
          />
        </FormField>
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
      </div>
      <FormActions sticky>
        <div />
        <div className="flex gap-2">
          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? "Removing..." : "Remove"}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={(!apiKey.trim() && !hasStoredKey) || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </FormActions>
    </>
  );
}

export function AiTab() {
  const { data: providers, isLoading, mutate } = useSWR("ai-providers", fetchAiProviders);
  const showSkeleton = useDelayedLoading(isLoading);

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
        title="AI Providers"
        description="Configure AI provider credentials for intelligent features."
      >
      <Tabs defaultValue={AI_PROVIDERS[0].id}>
        <TabsList className="w-full">
          {AI_PROVIDERS.map((p) => {
            const Icon = p.icon;
            const isConnected = !!providers?.find((s) => s.provider === p.id)?.api_key;
            return (
              <TabsTrigger key={p.id} value={p.id}>
                <Icon className="h-4 w-4" />
                {p.label}
                {isConnected && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Connected
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {AI_PROVIDERS.map((p) => (
          <TabsContent key={p.id} value={p.id}>
            <ProviderPanel
              provider={p}
              saved={providers?.find((s) => s.provider === p.id)}
              onSaved={() => mutate()}
            />
          </TabsContent>
        ))}
      </Tabs>
      </SettingsSection>
    </SettingsPage>
  );
}
