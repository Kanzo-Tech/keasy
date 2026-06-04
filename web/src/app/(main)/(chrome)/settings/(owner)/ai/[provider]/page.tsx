"use client";

import { use } from "react";
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

export default function EditAiProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: providerId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: providers = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  const saveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { api_key: string; model?: string; max_tokens?: number } }) =>
      api.ai.saveProvider(id, data),
    onSuccess: async () => {
      toast.success("AI provider updated");
      await queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
      router.push("/settings/ai");
    },
    onError: (err) => toastError(err, "Failed to update"),
  });

  if (isLoading) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  const providerData = providers.find((p) => p.provider === providerId);

  if (!providerData) {
    return <p className="text-muted-foreground">AI provider not found.</p>;
  }

  return (
    <AiProviderForm
      provider={providerData}
      allProviders={AI_PROVIDERS}
      isPending={saveMutation.isPending || saveMutation.isSuccess}
      onSubmit={(id, data) => saveMutation.mutate({ id, data })}
    />
  );
}
