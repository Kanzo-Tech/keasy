"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useAsync } from "@/hooks/use-async";
import { fetchSchema, fetchCloudAccount, updateCloudAccount } from "@/lib/api";
import { CloudAccountForm } from "@/components/cloud-account-form";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditCloudAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data, loading } = useAsync(
    () => Promise.all([fetchSchema(), fetchCloudAccount(id)]),
    [id],
  );

  const [schema, account] = data ?? [[], null];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!account) {
    return <p className="text-muted-foreground">Cloud account not found.</p>;
  }

  return (
    <>
      <PageHeader title={account.name} backHref="/settings?tab=cloud-accounts" backLabel="Cloud Accounts" />
      <CloudAccountForm
        schema={schema}
        account={account}
        onSubmit={async (data) => {
          try {
            await updateCloudAccount(id, {
              name: data.name,
              auth_method: data.auth_method,
              fields: data.fields,
            });
            toast.success("Cloud account updated");
            router.push("/settings?tab=cloud-accounts");
          } catch (err) {
            toastError(err instanceof Error ? err.message : "Failed to update");
            throw err;
          }
        }}
        onCancel={() => router.push("/settings?tab=cloud-accounts")}
      />
    </>
  );
}
