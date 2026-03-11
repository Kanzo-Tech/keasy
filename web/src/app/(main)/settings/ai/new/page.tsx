"use client";

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

export default function NewAiProviderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: existing = [], isLoading } = useQuery({
    queryKey: queryKeys.ai.providers,
    queryFn: api.ai.providers,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <PageShell>
        <PageShell.Content className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </PageShell.Content>
      </PageShell>
    ) : null;
  }

  const configuredIds = new Set(existing.map((p) => p.provider));

  return (
    <AiProviderForm
      allProviders={AI_PROVIDERS}
      disabledProviders={configuredIds}
      onSubmit={async (providerId, data) => {
        try {
          await api.ai.saveProvider(providerId, data);
          toast.success("AI provider created");
          queryClient.invalidateQueries({ queryKey: queryKeys.ai.providers });
          router.push("/settings/ai");
        } catch (err) {
          toastError(err instanceof Error ? err.message : "Failed to create");
          throw err;
        }
      }}
    />
  );
}
