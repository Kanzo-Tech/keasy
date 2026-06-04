"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { FormPageSkeleton } from "@/components/settings/form-page-skeleton";

export default function NewAiProviderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: existing = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const saveMutation = useMutation({
    mutationFn: ({ providerId, data }: { providerId: string; data: { api_key: string; model?: string; max_tokens?: number } }) =>
      api.ai.saveProvider(providerId, data),
    onSuccess: async () => {
      toast.success("AI provider created");
      await queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      router.push("/settings/ai");
    },
    onError: (err) => toastError(err, "Failed to create"),
  });

  if (isLoading) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  const configuredIds = new Set(existing.map((p) => p.provider));

  return (
    <AiProviderForm
      allProviders={AI_PROVIDERS}
      disabledProviders={configuredIds}
      isPending={saveMutation.isPending || saveMutation.isSuccess}
      onSubmit={(providerId, data) => saveMutation.mutate({ providerId, data })}
    />
  );
}
