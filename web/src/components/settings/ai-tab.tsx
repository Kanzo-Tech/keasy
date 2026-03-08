"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AiSettings } from "@/lib/types";

interface ProviderState {
  apiKey: string;
  model: string;
  maxTokens: string;
}

export function AiTab() {
  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useQuery({ queryKey: queryKeys.ai.providers, queryFn: api.ai.providers });
  const showSkeleton = useDelayedLoading(isLoading);

  const [activeTab, setActiveTab] = useState(AI_PROVIDERS[0].id);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Per-provider local form state
  const [formState, setFormState] = useState<Record<string, ProviderState>>({});

  function getState(providerId: string): ProviderState {
    if (formState[providerId]) return formState[providerId];
    const saved = providers?.find((s) => s.provider === providerId);
    return {
      apiKey: "",
      model: saved?.model ?? "",
      maxTokens: saved?.max_tokens?.toString() ?? "",
    };
  }

  function updateState(providerId: string, patch: Partial<ProviderState>) {
    setFormState((prev) => ({
      ...prev,
      [providerId]: { ...getState(providerId), ...patch },
    }));
  }

  const activeProvider = AI_PROVIDERS.find((p) => p.id === activeTab)!;
  const activeSaved = providers?.find((s) => s.provider === activeTab);
  const activeState = getState(activeTab);
  const isConnected = !!activeSaved?.api_key;

  const isDirty = !!(
    activeState.apiKey ||
    activeState.model !== (activeSaved?.model ?? "") ||
    activeState.maxTokens !== (activeSaved?.max_tokens?.toString() ?? "")
  ) && !saving && !removing;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.ai.saveProvider(activeTab, {
        api_key: activeState.apiKey,
        model: activeState.model.trim() || undefined,
        max_tokens: activeState.maxTokens.trim() ? parseInt(activeState.maxTokens.trim(), 10) : undefined,
      });
      setFormState((prev) => {
        const next = { ...prev };
        delete next[activeTab];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      toast.success(`${activeProvider.label} settings saved`);
    } catch {
      toast.error(`Failed to save ${activeProvider.label} settings`);
    } finally {
      setSaving(false);
    }
  }, [activeTab, activeState, activeProvider, queryClient]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await api.ai.removeProvider(activeTab);
      setFormState((prev) => {
        const next = { ...prev };
        delete next[activeTab];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      toast.success(`${activeProvider.label} removed`);
    } catch {
      toast.error(`Failed to remove ${activeProvider.label}`);
    } finally {
      setRemoving(false);
    }
  }, [activeTab, activeProvider, queryClient]);

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
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">AI Providers</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure AI provider credentials for intelligent features.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            {AI_PROVIDERS.map((p) => {
              const Icon = p.icon;
              const connected = !!providers?.find((s) => s.provider === p.id)?.api_key;
              return (
                <TabsTrigger key={p.id} value={p.id}>
                  <Icon className="h-4 w-4" />
                  {p.label}
                  {connected && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Connected
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {AI_PROVIDERS.map((p) => {
            const st = getState(p.id);
            const saved = providers?.find((s) => s.provider === p.id);
            return (
              <TabsContent key={p.id} value={p.id}>
                <div className="space-y-3">
                  <FormField label="API Key">
                    <SecretInput
                      hasStoredValue={!!saved?.api_key}
                      value={st.apiKey}
                      onChange={(e) => updateState(p.id, { apiKey: e.target.value })}
                      placeholder={`Enter your ${p.label} API key`}
                    />
                  </FormField>
                  <FormField
                    label="Model"
                    optional
                    description={`Defaults to ${p.defaultModel} if left empty.`}
                  >
                    <Input
                      value={st.model}
                      onChange={(e) => updateState(p.id, { model: e.target.value })}
                      placeholder={p.defaultModel}
                    />
                  </FormField>
                  <FormField
                    label="Max tokens"
                    optional
                    description="Controls AI response length. Defaults to 1024."
                  >
                    <Input
                      type="number"
                      value={st.maxTokens}
                      onChange={(e) => updateState(p.id, { maxTokens: e.target.value })}
                      placeholder="1024"
                      min={1}
                      max={32000}
                    />
                  </FormField>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </PageShell.Content>

      <PageShell.Footer>
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
            disabled={(!activeState.apiKey.trim() && !isConnected) || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </PageShell.Footer>
    </PageShell>
  );
}
