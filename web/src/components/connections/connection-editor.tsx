"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { getProviderIcon } from "@/lib/provider-icons";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ComingSoon } from "@/components/shared/coming-soon";
import { cn } from "@/lib/utils";
import type { ConnectionKind, LocationType } from "@/lib/types";

/** URL schemes per provider. First entry is the default. */
const PROVIDER_SCHEMES: Record<string, string[]> = {
  azure: ["az://", "azure://", "abfss://", "abfs://", "adl://"],
  s3: ["s3://"],
};

const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  azure: "my-container",
  s3: "my-bucket/prefix/",
};

export function ConnectionEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialType = (searchParams.get("type") as ConnectionKind) || "data";

  const { data } = useQuery({ queryKey: queryKeys.cloud.accounts, queryFn: api.cloud.list });
  const accounts = data ?? [];

  const [name, setName] = useState("");
  const [connectionKind, setConnectionKind] =
    useState<ConnectionKind>(initialType);
  const [locationType, setLocationType] = useState<LocationType>("cloud");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [url, setUrl] = useState("");
  const [selectedScheme, setSelectedScheme] = useState("");

  const selectedAccountObj = accounts.find((a) => a.id === selectedAccount);
  const schemes = selectedAccountObj
    ? (PROVIDER_SCHEMES[selectedAccountObj.provider_id] ?? [])
    : [];

  useEffect(() => {
    const acct = accounts.find((a) => a.id === selectedAccount);
    const providerSchemes = acct
      ? (PROVIDER_SCHEMES[acct.provider_id] ?? [])
      : [];
    setSelectedScheme(providerSchemes[0] ?? "");
  }, [selectedAccount, accounts]);

  const urlPlaceholder =
    locationType === "local"
      ? "/data/uploads/project/"
      : selectedAccountObj
        ? (PROVIDER_PLACEHOLDERS[selectedAccountObj.provider_id] ??
          "Container URL")
        : "Container URL";

  const canSave =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (locationType === "local" || !!selectedAccount);

  const createMutation = useMutation({
    mutationFn: () => {
      const fullUrl =
        locationType === "cloud" && selectedScheme
          ? `${selectedScheme}${url.trim()}`
          : url.trim();
      return api.connections.create({
        name: name.trim(),
        kind: connectionKind,
        location_type: locationType,
        cloud_account_id:
          locationType === "cloud" ? selectedAccount : undefined,
        url: fullUrl,
      });
    },
    onSuccess: async () => {
      toast.success("Connection created");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.connections.all() }),
        queryClient.invalidateQueries({ queryKey: ["connections-init"] }),
      ]);
      router.push(`/connections?type=${connectionKind}`);
    },
    onError: (err) => toastError(err, "Failed to create connection"),
  });

  const isDirty = !!(name || url || selectedAccount) && !createMutation.isPending;

  return (
    <PageShell>
      <UnsavedChangesGuard isDirty={isDirty} />
      <PageShell.Content>
      <FormField
        label="Name"
        description="Used as identifier in @references (e.g. @my-connection/file.csv)"
        required
      >
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
              "flex flex-col items-start gap-1 rounded-md border p-3 transition-colors cursor-pointer",
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
              "flex flex-col items-start gap-1 rounded-md border p-3 transition-colors cursor-pointer",
              connectionKind === "vocab"
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <RadioGroupItem value="vocab" id="type-vocab" className="sr-only" />
            <p className="text-sm font-medium leading-none">Vocabulary</p>
            <p className="text-xs text-muted-foreground">
              RDF vocabularies and ontologies
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
              "flex flex-col items-start gap-1 rounded-md border p-3 transition-colors cursor-pointer",
              locationType === "cloud"
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <RadioGroupItem value="cloud" id="loc-cloud" className="sr-only" />
            <p className="text-sm font-medium leading-none">Cloud</p>
            <p className="text-xs text-muted-foreground">
              S3 or Azure storage
            </p>
          </Label>
          <ComingSoon placement="inline">
            <Label
              htmlFor="loc-local"
              className="flex flex-col items-start gap-1 rounded-md border border-border p-3"
            >
              <RadioGroupItem
                value="local"
                id="loc-local"
                disabled
                className="sr-only"
              />
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
                <Link
                  href="/settings/cloud-accounts"
                  className="text-primary hover:underline"
                >
                  Create one first
                </Link>
                .
              </p>
            ) : (
              <Combobox
                options={accounts.map((a) => {
                  const Icon = getProviderIcon(a.provider_id);
                  return {
                    value: a.id,
                    label: a.name,
                    suffix: <Icon className="h-3.5 w-3.5 ml-auto opacity-60" />,
                  };
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
            <div className="flex">
              {selectedAccountObj && schemes.length === 1 && (
                <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-2.5 text-sm text-muted-foreground font-mono h-8">
                  {schemes[0]}
                </span>
              )}
              {selectedAccountObj && schemes.length > 1 && (
                <Select
                  value={selectedScheme}
                  onValueChange={setSelectedScheme}
                >
                  <SelectTrigger
                    size="sm"
                    className="rounded-r-none border-r-0 font-mono w-auto shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {schemes.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={urlPlaceholder}
                className={cn(
                  "h-8 text-sm font-mono flex-1",
                  selectedAccountObj && schemes.length > 0 && "rounded-l-none",
                )}
              />
            </div>
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

      </PageShell.Content>
      <PageShell.Footer>
        <div />
        <Button size="sm" disabled={!canSave || createMutation.isPending || createMutation.isSuccess} onClick={() => createMutation.mutate()}>
          {createMutation.isPending || createMutation.isSuccess ? "Creating..." : "Create"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
