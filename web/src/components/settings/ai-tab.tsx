"use client";

import { useCallback } from "react";
import type { ComponentType } from "react";
import { toast } from "sonner";
import { SiAnthropic, SiOpenai } from "react-icons/si";
import { useAsync } from "@/hooks/use-async";
import { fetchAiSettings, saveAiSettings } from "@/lib/api";
import { SchemaForm } from "@/components/schema-form";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProviderSchema } from "@/lib/types";

const AI_SCHEMA: ProviderSchema[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    icon: "anthropic",
    common_fields: [
      { name: "api_key", label: "API Key", secret: true },
      {
        name: "model",
        label: "Model",
        secret: false,
        optional: true,
        default_value: "claude-sonnet-4-20250514",
      },
    ],
    auth_methods: [],
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: "openai",
    common_fields: [
      { name: "api_key", label: "API Key", secret: true },
      {
        name: "model",
        label: "Model",
        secret: false,
        optional: true,
        default_value: "gpt-4o",
      },
    ],
    auth_methods: [],
  },
];

const AI_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  anthropic: SiAnthropic,
  openai: SiOpenai,
};

function getAiIcon(icon: string): ComponentType<{ className?: string }> {
  return AI_ICONS[icon] ?? SiAnthropic;
}

export function AiTab() {
  const { data: settings, loading } = useAsync(() => fetchAiSettings(), []);

  const handleSave = useCallback(
    async (data: { provider_id: string; fields: Record<string, string> }) => {
      await saveAiSettings({
        provider: data.provider_id,
        api_key: data.fields.api_key ?? "",
        model: data.fields.model?.trim() || undefined,
      });
      toast.success("AI settings saved");
    },
    [],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <SchemaForm
      schema={AI_SCHEMA}
      getIcon={getAiIcon}
      initial={settings ? {
        provider_id: settings.provider || "anthropic",
        fields: {
          api_key: settings.api_key || "",
          ...(settings.model ? { model: settings.model } : {}),
        },
      } : undefined}
      submitLabel="Save"
      onSubmit={handleSave}
      preserveFields
    />
  );
}
