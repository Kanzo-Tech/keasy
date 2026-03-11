"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SecretInput } from "@/components/ui/secret-input";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { cn } from "@/lib/utils";
import type { AiSettings } from "@/lib/types";
import type { AiProviderOption } from "@/lib/ai-providers";

interface AiProviderFormProps {
  provider?: AiSettings;
  allProviders: AiProviderOption[];
  disabledProviders?: Set<string>;
  onSubmit: (providerId: string, data: {
    api_key: string;
    model?: string;
    max_tokens?: number;
  }) => Promise<void>;
}

export function AiProviderForm({ provider, allProviders, disabledProviders, onSubmit }: AiProviderFormProps) {
  const isEdit = !!provider;

  const [selectedId, setSelectedId] = useState(provider?.provider ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(provider?.max_tokens?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const displayProvider = allProviders.find((p) => p.id === (selectedId || provider?.provider));

  const isDirty = isEdit
    ? !!(apiKey || model !== (provider?.model ?? "") || maxTokens !== (provider?.max_tokens?.toString() ?? "")) && !saving
    : !!(selectedId || apiKey) && !saving;

  const canSubmit = isEdit
    ? isDirty
    : !!(selectedId && apiKey.trim());

  async function handleSubmit() {
    setSaving(true);
    try {
      await onSubmit(selectedId, {
        api_key: apiKey,
        model: model.trim() || undefined,
        max_tokens: maxTokens.trim() ? parseInt(maxTokens.trim(), 10) : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content className="space-y-4">
        {isEdit ? (
          <Badge variant="secondary" className="w-fit">
            {displayProvider?.label ?? provider?.provider}
          </Badge>
        ) : (
          <RadioGroup
            value={selectedId}
            onValueChange={(v) => {
              if (!disabledProviders?.has(v)) setSelectedId(v);
            }}
            className="grid grid-cols-3 gap-3"
          >
            {allProviders.map((p) => {
              const Icon = p.icon;
              const isDisabled = disabledProviders?.has(p.id);
              return (
                <Label
                  key={p.id}
                  htmlFor={`provider-${p.id}`}
                  className={cn(
                    "flex flex-col items-center justify-center text-center gap-2 py-4 px-3 rounded-md border transition-colors",
                    isDisabled
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer",
                    !isDisabled && selectedId === p.id
                      ? "border-primary bg-accent"
                      : "border-border",
                    !isDisabled && selectedId !== p.id && "hover:bg-accent/50",
                  )}
                >
                  <RadioGroupItem value={p.id} id={`provider-${p.id}`} className="sr-only" disabled={isDisabled} />
                  <Icon className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs font-medium">{p.label}</span>
                  {isDisabled && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Configured</Badge>}
                </Label>
              );
            })}
          </RadioGroup>
        )}

        {(selectedId || isEdit) && (
          <>
            <FormField label="API Key" required={!isEdit}>
              <SecretInput
                hasStoredValue={isEdit && !!provider?.api_key}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${displayProvider?.label ?? selectedId} API key`}
                className="h-8 text-sm"
              />
            </FormField>

            <FormField
              label="Model"
              optional
              description={`Defaults to ${displayProvider?.defaultModel ?? "provider default"} if left empty.`}
            >
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={displayProvider?.defaultModel}
                className="h-8 text-sm"
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
                className="h-8 text-sm"
              />
            </FormField>
          </>
        )}
      </PageShell.Content>

      <PageShell.Footer>
        <div />
        <Button
          size="sm"
          disabled={!canSubmit || saving}
          onClick={handleSubmit}
        >
          {saving ? "Saving..." : isEdit ? "Save" : "Create"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
