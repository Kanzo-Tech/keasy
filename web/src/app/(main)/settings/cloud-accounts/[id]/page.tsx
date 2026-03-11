"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { CloudAccountForm } from "@/components/settings/cloud-account-form";
import { FormPageSkeleton } from "@/components/settings/form-page-skeleton";

export default function EditCloudAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: schema = [], isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.settings.schema,
    queryFn: api.settings.schema,
  });
  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: queryKeys.cloud.detail(id),
    queryFn: () => api.cloud.get(id),
  });
  const isLoading = schemaLoading || accountLoading;
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  if (!account) {
    return <p className="text-muted-foreground">Cloud account not found.</p>;
  }

  return (
    <CloudAccountForm
      schema={schema}
      account={account}
      onSubmit={async (data) => {
        try {
          await api.cloud.update(id, {
            name: data.name,
            auth_method: data.auth_method,
            fields: data.fields,
          });
          toast.success("Cloud account updated");
          queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
          router.push("/settings/cloud-accounts");
        } catch (err) {
          toastError(err instanceof Error ? err.message : "Failed to update");
          throw err;
        }
      }}
    />
  );
}
