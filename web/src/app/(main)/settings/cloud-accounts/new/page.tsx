"use client";

import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import useSWR from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { CloudAccountForm } from "@/components/settings/cloud-account-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewCloudAccountPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: schema, isLoading } = useSWR("schema", api.settings.schema);
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading || !schema) {
    return showSkeleton ? (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : null;
  }

  return (
    <CloudAccountForm
      schema={schema}
      onSubmit={async (data) => {
        try {
          await api.cloud.create(data);
          toast.success("Cloud account created");
          mutate("cloud-init");
          router.push("/settings/cloud-accounts");
        } catch (err) {
          toastError(err instanceof Error ? err.message : "Failed to create");
          throw err;
        }
      }}
    />
  );
}
