"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import useSWR, { useSWRConfig } from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { fetchSchema, fetchCloudAccounts, createConnection } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { FormField, FormActions } from "@/components/form-layout";
import { CloudAccountPicker } from "@/components/cloud-account-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ComingSoon } from "@/components/coming-soon";
import { cn } from "@/lib/utils";
import type { ConnectionKind, LocationType } from "@/lib/types";

const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  azure: "az://my-container",
  s3: "s3://my-bucket/prefix/",
  gcs: "gs://my-bucket/prefix/",
};

export default function NewConnectionPage() {
  return (
    <Suspense>
      <NewConnectionContent />
    </Suspense>
  );
}

function NewConnectionContent() {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const searchParams = useSearchParams();
  const initialType = (searchParams.get("type") as ConnectionKind) || "data";

  const { data, isLoading } = useSWR(
    "connection-new-init",
    () => Promise.all([fetchSchema(), fetchCloudAccounts()]),
  );
  const showSkeleton = useDelayedLoading(isLoading);
  const [schema, accounts] = data ?? [[], []];

  const [name, setName] = useState("");
  const [connectionKind, setConnectionKind] = useState<ConnectionKind>(initialType);
  const [locationType, setLocationType] = useState<LocationType>("cloud");
  const [selectedAccount, setSelectedAccount] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const accountId = selectedAccount[0] ?? "";
  const selectedAccountObj = accounts.find((a) => a.id === accountId);
  const urlPlaceholder =
    locationType === "local"
      ? "/data/uploads/project/"
      : selectedAccountObj
        ? PROVIDER_PLACEHOLDERS[selectedAccountObj.provider_id] ?? "Container URL"
        : "Container URL";

  const canSave =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (locationType === "local" || !!accountId);

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await createConnection({
        name: name.trim(),
        kind: connectionKind,
        location_type: locationType,
        cloud_account_id: locationType === "cloud" ? accountId : undefined,
        url: url.trim(),
      });
      toast.success("Connection created");
      globalMutate((key: string) => typeof key === "string" && key.startsWith("connections-init"));
      router.push(`/connections?type=${connectionKind}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return showSkeleton ? (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : null;
  }

  return (
    <>
      <PageHeader title="New Connection" backHref={`/connections?type=${connectionKind}`} backLabel="Connections" />
      <div className="flex flex-col gap-4">
        <FormField label="Name" description="Used as identifier in @references (e.g. @my-connection/file.csv)" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. hr-data"
            className="h-8 text-sm"
          />
        </FormField>

        <FormField label="Type" required>
          <RadioGroup
            value={connectionKind}
            onValueChange={(v) => setConnectionKind(v as ConnectionKind)}
            className="flex gap-2"
          >
            <Label
              htmlFor="type-data"
              className={cn(
                "flex-1 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                connectionKind === "data"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30",
              )}
            >
              <RadioGroupItem value="data" id="type-data" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-none">Data</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Read/write data for fossil pipelines
                </p>
              </div>
            </Label>
            <Label
              htmlFor="type-vocab"
              className={cn(
                "flex-1 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                connectionKind === "vocab"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30",
              )}
            >
              <RadioGroupItem value="vocab" id="type-vocab" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-none">Vocabulary</p>
                <p className="text-xs text-muted-foreground mt-1">
                  ShEx/SHACL shapes for validation
                </p>
              </div>
            </Label>
          </RadioGroup>
        </FormField>

        <FormField label="Location" required>
          <RadioGroup
            value={locationType}
            onValueChange={(v) => setLocationType(v as LocationType)}
            className="flex gap-2"
          >
            <Label
              htmlFor="loc-cloud"
              className={cn(
                "flex-1 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                locationType === "cloud"
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:border-muted-foreground/30",
              )}
            >
              <RadioGroupItem value="cloud" id="loc-cloud" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium leading-none">Cloud</p>
                <p className="text-xs text-muted-foreground mt-1">
                  S3, GCS, or Azure storage
                </p>
              </div>
            </Label>
            <ComingSoon placement="inline" className="flex-1">
              <Label
                htmlFor="loc-local"
                className="flex items-start gap-3 rounded-lg border border-border p-3 text-left"
              >
                <RadioGroupItem value="local" id="loc-local" disabled className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium leading-none">Local</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Local filesystem path
                  </p>
                </div>
              </Label>
            </ComingSoon>
          </RadioGroup>
        </FormField>

        {locationType === "cloud" && (
          <FormField label="Cloud Account" required>
            <CloudAccountPicker
              schema={schema}
              accounts={accounts}
              value={selectedAccount}
              onChange={setSelectedAccount}
              single
            />
          </FormField>
        )}

        <FormField label="URL" required>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={urlPlaceholder}
            className="h-8 text-sm font-mono"
          />
        </FormField>

        <FormActions>
          <Button variant="ghost" size="sm" onClick={() => router.push(`/connections?type=${connectionKind}`)}>
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
