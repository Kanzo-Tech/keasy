"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import useSWR, { useSWRConfig } from "swr";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import Link from "next/link";
import { fetchCloudAccounts, createConnection } from "@/lib/api";
import { getProviderIcon } from "@/lib/provider-icons";
import { PageHeader } from "@/components/page-header";
import { FormField, FormActions } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ComingSoon } from "@/components/coming-soon";
import { ScrollArea } from "@/components/ui/scroll-area";
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
    fetchCloudAccounts,
  );
  const showSkeleton = useDelayedLoading(isLoading);
  const accounts = data ?? [];

  const [name, setName] = useState("");
  const [connectionKind, setConnectionKind] = useState<ConnectionKind>(initialType);
  const [locationType, setLocationType] = useState<LocationType>("cloud");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedAccountObj = accounts.find((a) => a.id === selectedAccount);
  const urlPlaceholder =
    locationType === "local"
      ? "/data/uploads/project/"
      : selectedAccountObj
        ? PROVIDER_PLACEHOLDERS[selectedAccountObj.provider_id] ?? "Container URL"
        : "Container URL";

  const canSave =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (locationType === "local" || !!selectedAccount);

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await createConnection({
        name: name.trim(),
        kind: connectionKind,
        location_type: locationType,
        cloud_account_id: locationType === "cloud" ? selectedAccount : undefined,
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
    <ScrollArea className="flex-1 min-h-0">
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
            className="grid grid-cols-2 gap-2"
          >
            <Label
              htmlFor="type-data"
              className={cn(
                "flex flex-col items-center justify-center text-center gap-1 rounded-md border p-3 transition-colors cursor-pointer",
                connectionKind === "data"
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <RadioGroupItem value="data" id="type-data" className="sr-only" />
              <p className="text-sm font-medium leading-none">Data</p>
              <p className="text-xs text-muted-foreground">
                Read/write data for fossil pipelines
              </p>
            </Label>
            <Label
              htmlFor="type-vocab"
              className={cn(
                "flex flex-col items-center justify-center text-center gap-1 rounded-md border p-3 transition-colors cursor-pointer",
                connectionKind === "vocab"
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <RadioGroupItem value="vocab" id="type-vocab" className="sr-only" />
              <p className="text-sm font-medium leading-none">Vocabulary</p>
              <p className="text-xs text-muted-foreground">
                ShEx/SHACL shapes for validation
              </p>
            </Label>
          </RadioGroup>
        </FormField>

        <FormField label="Location" required>
          <RadioGroup
            value={locationType}
            onValueChange={(v) => setLocationType(v as LocationType)}
            className="grid grid-cols-2 gap-2"
          >
            <Label
              htmlFor="loc-cloud"
              className={cn(
                "flex flex-col items-center justify-center text-center gap-1 rounded-md border p-3 transition-colors cursor-pointer",
                locationType === "cloud"
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50",
              )}
            >
              <RadioGroupItem value="cloud" id="loc-cloud" className="sr-only" />
              <p className="text-sm font-medium leading-none">Cloud</p>
              <p className="text-xs text-muted-foreground">
                S3, GCS, or Azure storage
              </p>
            </Label>
            <ComingSoon placement="inline">
              <Label
                htmlFor="loc-local"
                className="flex flex-col items-center justify-center text-center gap-1 rounded-md border border-border p-3"
              >
                <RadioGroupItem value="local" id="loc-local" disabled className="sr-only" />
                <p className="text-sm font-medium leading-none">Local</p>
                <p className="text-xs text-muted-foreground">
                  Local filesystem path
                </p>
              </Label>
            </ComingSoon>
          </RadioGroup>
        </FormField>

        {locationType === "cloud" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Cloud Account" required>
              {accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No cloud accounts configured.{" "}
                  <Link href="/settings/cloud-accounts" className="text-primary hover:underline">
                    Create one first
                  </Link>
                  .
                </p>
              ) : (
                <Combobox
                  options={accounts.map((a) => {
                    const Icon = getProviderIcon(a.provider_id);
                    return { value: a.id, label: a.name, suffix: <Icon className="h-3.5 w-3.5 ml-auto opacity-60" /> };
                  })}
                  value={selectedAccount}
                  onValueChange={setSelectedAccount}
                  placeholder="Select account..."
                  searchPlaceholder="Search accounts..."
                  emptyMessage="No accounts found."
                  className="h-8 text-sm"
                />
              )}
            </FormField>
            <FormField label="URL" required>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={urlPlaceholder}
                className="h-8 text-sm font-mono"
              />
            </FormField>
          </div>
        ) : (
          <FormField label="URL" required>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={urlPlaceholder}
              className="h-8 text-sm font-mono"
            />
          </FormField>
        )}

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
    </ScrollArea>
  );
}
