"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { AiProviderForm } from "@/components/settings/ai-provider-form";
import { PageShell } from "@/components/layout/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

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

  if (isLoading) {
    return showSkeleton ? (
      <PageShell>
        <PageShell.Content>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </PageShell.Content>
      </PageShell>
    ) : null;
  }

  const providerData = providers.find((p) => p.provider === providerId);

  if (!providerData) {
    return <p className="text-muted-foreground">AI provider not found.</p>;
  }

  return (
    <AiProviderForm
      provider={providerData}
      allProviders={AI_PROVIDERS}
      onSubmit={async (id, data) => {
        try {
          await api.ai.saveProvider(id, data);
          toast.success("AI provider updated");
          queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
          router.push("/settings/ai");
        } catch (err) {
          toastError(err instanceof Error ? err.message : "Failed to update");
          throw err;
        }
      }}
    />
  );
}
