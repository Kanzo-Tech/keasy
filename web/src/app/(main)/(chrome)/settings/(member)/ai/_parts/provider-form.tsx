"use client";

import { useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";
import type { AiSettings } from "@/lib/types";

/** Adds a provider, or edits `providerId`'s. */
export function ProviderForm({ providerId }: { providerId?: string }) {
  const { data: configured = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <SectionRoot>
        <SectionBody scale="page">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </SectionBody>
      </SectionRoot>
    ) : null;
  }

  const existing = configured.find((p) => p.provider === providerId);
  if (providerId && !existing) notFound();

  return <Form configured={configured} existing={existing} />;
}

function Form({ configured, existing }: { configured: AiSettings[]; existing?: AiSettings }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const taken = new Set(configured.map((p) => p.provider));

  const [selectedId, setSelectedId] = useState(
    existing?.provider ?? AI_PROVIDERS.find((p) => !taken.has(p.id))?.id ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(existing?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(existing?.max_tokens?.toString() ?? "");
  const option = AI_PROVIDERS.find((p) => p.id === selectedId);

  const save = useMutation({
    mutationFn: () =>
      api.ai.saveProvider(selectedId, {
        api_key: apiKey,
        model: model.trim() || undefined,
        max_tokens: maxTokens.trim() ? parseInt(maxTokens.trim(), 10) : undefined,
      }),
    onSuccess: async () => {
      toast.create({ title: existing ? "AI provider updated" : "AI provider created", type: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      router.push("/settings/ai");
    },
    onError: (err) => toastError(err, existing ? "Failed to update" : "Failed to create"),
  });
  const saving = save.isPending || save.isSuccess;

  const dirty = existing
    ? !!apiKey || model !== (existing.model ?? "") || maxTokens !== (existing.max_tokens?.toString() ?? "")
    : !!(selectedId || apiKey);
  useBeforeUnload(dirty && !saving);

  return (
    <SectionRoot>
      <SectionBody scale="page">
        {existing ? (
          <Badge className="w-fit" variant="secondary">
            {option?.label ?? existing.provider}
          </Badge>
        ) : (
          <RadioGroup
            className="text-center *:flex-col *:items-center *:justify-center"
            columns={3}
            onValueChange={(details) => setSelectedId(details.value ?? "")}
            value={selectedId}
          >
            {AI_PROVIDERS.map((p) => (
              <RadioGroupCard disabled={taken.has(p.id)} key={p.id} value={p.id}>
                <p.icon className="size-6 shrink-0 text-muted-foreground" />
                <RadioGroupText>{p.label}</RadioGroupText>
                {taken.has(p.id) && (
                  <Badge size="xs" variant="outline">
                    Configured
                  </Badge>
                )}
              </RadioGroupCard>
            ))}
          </RadioGroup>
        )}

        {selectedId && (
          <>
            <Field required={!existing}>
              <FieldLabel>
                API Key
                <FieldRequiredIndicator />
              </FieldLabel>
              {/* Rendered EMPTY; submitting it empty keeps the stored secret. */}
              <PasswordInput>
                <PasswordInputGroup>
                  <PasswordInputInput
                    hasStoredValue={!!existing?.api_key}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={`Enter your ${option?.label ?? selectedId} API key`}
                    storedPlaceholder="Leave empty to keep current"
                    value={apiKey}
                  />
                  <PasswordInputTrigger />
                </PasswordInputGroup>
              </PasswordInput>
            </Field>

            <Field>
              <FieldLabel>Model</FieldLabel>
              <FieldDescription>
                Defaults to {option?.defaultModel ?? "the provider default"} if left empty.
              </FieldDescription>
              <Input
                onChange={(e) => setModel(e.target.value)}
                placeholder={option?.defaultModel}
                value={model}
              />
            </Field>

            <Field>
              <FieldLabel>Max tokens</FieldLabel>
              <FieldDescription>Controls AI response length. Defaults to 1024.</FieldDescription>
              <Input
                max={32000}
                min={1}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="1024"
                type="number"
                value={maxTokens}
              />
            </Field>
          </>
        )}
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button
          disabled={existing ? !dirty : !(selectedId && apiKey.trim())}
          isLoading={saving}
          onClick={() => save.mutate()}
          size="sm"
        >
          {existing ? "Save" : "Create"}
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
