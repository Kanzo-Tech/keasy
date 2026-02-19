"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useAsync } from "@/hooks/use-async";
import { fetchSchema, fetchCloudAccounts, createConnection } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { FormField, FormActions } from "@/components/form-layout";
import { CloudAccountPicker } from "@/components/cloud-account-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  azure: "az://my-container",
  s3: "s3://my-bucket",
  gcs: "gs://my-bucket",
};

export default function NewConnectionPage() {
  const router = useRouter();
  const { data, loading } = useAsync(
    () => Promise.all([fetchSchema(), fetchCloudAccounts()]),
    [],
  );
  const [schema, accounts] = data ?? [[], []];

  const [name, setName] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const accountId = selectedAccount[0] ?? "";
  const selectedAccountObj = accounts.find((a) => a.id === accountId);
  const urlPlaceholder = selectedAccountObj
    ? PROVIDER_PLACEHOLDERS[selectedAccountObj.provider_id] ?? "Container URL"
    : "Container URL";

  const canSave = name.trim().length > 0 && !!accountId && url.trim().length > 0;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await createConnection({
        name: name.trim(),
        cloud_account_id: accountId,
        container_url: url.trim(),
      });
      toast.success("Connection created");
      router.push("/connections");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="New Connection" backHref="/connections" backLabel="Connections" />
      <div className="flex flex-col gap-4">
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. DCAT Vocabularies"
            className="h-8 text-sm"
          />
        </FormField>

        <FormField label="Cloud Account" required>
          <CloudAccountPicker
            schema={schema}
            accounts={accounts}
            value={selectedAccount}
            onChange={setSelectedAccount}
            single
          />
        </FormField>

        <FormField label="Container URL" required>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={urlPlaceholder}
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormActions>
          <Button variant="ghost" size="sm" onClick={() => router.push("/connections")}>
            <ArrowLeft size={14} />
            Back
          </Button>
          <Button size="sm" disabled={!canSave || saving} onClick={handleSubmit}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
