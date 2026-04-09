"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { allProviders, toProviderPayload } from "@/lib/ai/providers";
import { RegistryForm } from "@/lib/schemas/registry-form";
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
    mutationFn: (data: { typeId: string; config: Record<string, string> }) =>
      api.ai.saveProvider(data.typeId, toProviderPayload(data.config)),
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
  const availableProviders = allProviders.filter((p) => !configuredIds.has(p.id));

  return (
    <RegistryForm
      types={availableProviders}
      typeLabel="AI Provider"
      typeDescription="Choose an AI provider to configure"
      showName={false}
      onSubmit={(data) => saveMutation.mutate(data)}
      isPending={saveMutation.isPending}
      isSuccess={saveMutation.isSuccess}
      submitLabel="Create"
      backHref="/settings/ai"
    />
  );
}
