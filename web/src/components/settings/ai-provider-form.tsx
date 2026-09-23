"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
} from "@kanzo-tech/ui";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
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
  }) => void;
  isPending?: boolean;
}

export function AiProviderForm({ provider, allProviders, disabledProviders, onSubmit, isPending = false }: AiProviderFormProps) {
  const isEdit = !!provider;

  const [selectedId, setSelectedId] = useState(
    provider?.provider ?? allProviders.find((p) => !disabledProviders?.has(p.id))?.id ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(provider?.max_tokens?.toString() ?? "");

  const displayProvider = allProviders.find((p) => p.id === (selectedId || provider?.provider));

  const providerOptions = useMemo(
    () =>
      allProviders.map((p) => ({
        id: p.id,
        label: p.label,
        Icon: p.icon,
        disabled: disabledProviders?.has(p.id) ?? false,
      })),
    [allProviders, disabledProviders],
  );

  const isDirty = isEdit
    ? !!(apiKey || model !== (provider?.model ?? "") || maxTokens !== (provider?.max_tokens?.toString() ?? "")) && !isPending
    : !!(selectedId || apiKey) && !isPending;

  const canSubmit = isEdit
    ? isDirty
    : !!(selectedId && apiKey.trim());

  function handleSubmit() {
    onSubmit(selectedId, {
      api_key: apiKey,
      model: model.trim() || undefined,
      max_tokens: maxTokens.trim() ? parseInt(maxTokens.trim(), 10) : undefined,
    });
  }

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content>
        {isEdit ? (
          <Badge variant="secondary" className="w-fit">
            {displayProvider?.label ?? provider?.provider}
          </Badge>
        ) : (
          <RadioGroup
            className="text-center *:flex-col *:items-center *:justify-center"
            columns={3}
            onValueChange={(details) => setSelectedId(details.value ?? "")}
            value={selectedId}
          >
            {providerOptions.map((option) => (
              <RadioGroupCard disabled={option.disabled} key={option.id} value={option.id}>
                <option.Icon className="size-6 shrink-0 text-muted-foreground" />
                <RadioGroupText>{option.label}</RadioGroupText>
                {option.disabled && (
                  <Badge size="xs" variant="outline">
                    Configured
                  </Badge>
                )}
              </RadioGroupCard>
            ))}
          </RadioGroup>
        )}

        {(selectedId || isEdit) && (
          <>
            <FormField label="API Key" required={!isEdit}>
              {/* `hasStoredValue` is the library's own credential shape: the field renders
                  EMPTY and submitting it empty keeps the stored secret. */}
              <PasswordInput>
                <PasswordInputGroup>
                  <PasswordInputInput
                    hasStoredValue={isEdit && !!provider?.api_key}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={`Enter your ${displayProvider?.label ?? selectedId} API key`}
                    storedPlaceholder="Leave empty to keep current"
                    value={apiKey}
                  />
                  <PasswordInputTrigger />
                </PasswordInputGroup>
              </PasswordInput>
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
          disabled={!canSubmit || isPending}
          onClick={handleSubmit}
        >
          {isPending ? "Saving..." : isEdit ? "Save" : "Create"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
