"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { CloudAccountForm } from "@/components/settings/cloud-account-form";
import { FormPageSkeleton } from "@/components/settings/form-page-skeleton";

export default function NewCloudAccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: schema, isLoading } = useQuery({ queryKey: queryKeys.settings.schema, queryFn: api.settings.schema });
  const showSkeleton = useDelayedLoading(isLoading);

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; provider_id: string; auth_method?: string; fields: Record<string, string> }) =>
      api.cloud.create(data),
    onSuccess: async () => {
      toast.success("Cloud account created");
      await queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
      router.push("/settings/cloud-accounts");
    },
    onError: (err) => toastError(err, "Failed to create"),
  });

  if (isLoading || !schema) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  return (
    <CloudAccountForm
      schema={schema}
      isPending={saveMutation.isPending || saveMutation.isSuccess}
      onSubmit={(data) => saveMutation.mutate(data)}
    />
  );
}
