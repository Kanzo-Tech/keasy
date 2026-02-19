"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useAsync } from "@/hooks/use-async";
import { fetchSchema, createCloudAccount } from "@/lib/api";
import { CloudAccountForm } from "@/components/cloud-account-form";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewCloudAccountPage() {
  const router = useRouter();
  const { data: schema, loading } = useAsync(() => fetchSchema(), []);

  if (loading || !schema) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="New Cloud Account" backHref="/settings?tab=cloud-accounts" backLabel="Cloud Accounts" />
      <CloudAccountForm
        schema={schema}
        onSubmit={async (data) => {
          try {
            await createCloudAccount(data);
            toast.success("Cloud account created");
            router.push("/settings?tab=cloud-accounts");
          } catch (err) {
            toastError(err instanceof Error ? err.message : "Failed to create");
            throw err;
          }
        }}
        onCancel={() => router.push("/settings?tab=cloud-accounts")}
      />
    </>
  );
}
