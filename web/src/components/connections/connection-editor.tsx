"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@kanzo-tech/ui";
import { toastError } from "@/lib/toast-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { getProviderIcon } from "@/lib/provider-icons";
import { FormField } from "@/components/shared/form-layout";
import { PageShell } from "@/components/layout/page-shell";
import { UnsavedChangesGuard } from "@/components/shared/unsaved-changes-guard";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  Input,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  createListCollection,
  useFilter,
} from "@kanzo-tech/ui";
import { ComingSoon } from "@/components/shared/coming-soon";
import type { ConnectionKind, LocationType } from "@/lib/types";

/** URL schemes per provider. First entry is the default. */
const PROVIDER_SCHEMES: Record<string, string[]> = {
  azure: ["az://", "azure://", "abfss://", "abfs://", "adl://"],
  s3: ["s3://"],
};

const EMPTY_SCHEMES: string[] = [];

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
  // Memoised, not `data ?? []` inline: a fresh array each render makes every collection
  // below rebuild, which the compiler refuses to memoise through.
  const accounts = useMemo(() => data ?? [], [data]);

  const [name, setName] = useState("");
  const [connectionKind, setConnectionKind] =
    useState<ConnectionKind>(initialType);
  const [locationType, setLocationType] = useState<LocationType>("cloud");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [url, setUrl] = useState("");
  // Tagged with the account it was picked for, so switching account falls back
  // to that provider's default scheme without an effect.
  const [schemeChoice, setSchemeChoice] = useState<{
    account: string;
    scheme: string;
  } | null>(null);

  const selectedAccountObj = accounts.find((a) => a.id === selectedAccount);
  const schemes = useMemo(
    () =>
      selectedAccountObj
        ? (PROVIDER_SCHEMES[selectedAccountObj.provider_id] ?? EMPTY_SCHEMES)
        : EMPTY_SCHEMES,
    [selectedAccountObj],
  );
  const selectedScheme =
    schemeChoice?.account === selectedAccount
      ? schemeChoice.scheme
      : (schemes[0] ?? "");

  const urlPlaceholder =
    locationType === "local"
      ? "/data/uploads/project/"
      : selectedAccountObj
        ? (PROVIDER_PLACEHOLDERS[selectedAccountObj.provider_id] ??
          "Container URL")
        : "Container URL";

  // Ark's combobox filters a COLLECTION rather than a children array, and `useFilter` is
  // locale-aware, so "azur" still finds "Azure Producción". The collection is derived from
  // the query rather than seeded through `useListCollection`: that hook keeps its own
  // state from `initialItems`, which is `[]` on the first render of an async list.
  const { contains } = useFilter({ sensitivity: "base" });
  const [accountQuery, setAccountQuery] = useState("");
  const accountCollection = useMemo(
    () =>
      createListCollection({
        items: accounts
          .filter((a) => contains(a.name, accountQuery))
          .map((a) => ({ label: a.name, provider: a.provider_id, value: a.id })),
      }),
    [accounts, accountQuery, contains],
  );

  const schemeCollection = useMemo(
    () => createListCollection({ items: schemes.map((s) => ({ label: s, value: s })) }),
    [schemes],
  );

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
      toast.create({ title: "Connection created", type: "success" });
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
          className="*:items-start"
          columns={2}
          onValueChange={(details) =>
            setConnectionKind((details.value ?? "data") as ConnectionKind)
          }
          value={connectionKind}
        >
          <RadioGroupCard className="flex-col gap-1" value="data">
            <RadioGroupText className="font-medium text-sm leading-none">Data</RadioGroupText>
            <span className="text-muted-foreground text-xs">
              Read/write data for fossil pipelines
            </span>
          </RadioGroupCard>
          <RadioGroupCard className="flex-col gap-1" value="vocab">
            <RadioGroupText className="font-medium text-sm leading-none">Vocabulary</RadioGroupText>
            <span className="text-muted-foreground text-xs">
              RDF vocabularies and ontologies
            </span>
          </RadioGroupCard>
        </RadioGroup>
      </FormField>

      <FormField label="Location" required>
        <RadioGroup
          className="*:items-start"
          columns={2}
          onValueChange={(details) =>
            setLocationType((details.value ?? "cloud") as LocationType)
          }
          value={locationType}
        >
          <RadioGroupCard className="flex-col gap-1" value="cloud">
            <RadioGroupText className="font-medium text-sm leading-none">Cloud</RadioGroupText>
            <span className="text-muted-foreground text-xs">S3 or Azure storage</span>
          </RadioGroupCard>
          <ComingSoon placement="inline">
            <RadioGroupCard className="h-full flex-col gap-1" disabled value="local">
              <RadioGroupText className="font-medium text-sm leading-none">Local</RadioGroupText>
              <span className="text-muted-foreground text-xs">Local filesystem path</span>
            </RadioGroupCard>
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
                collection={accountCollection}
                onInputValueChange={(details) => setAccountQuery(details.inputValue)}
                onValueChange={(details) => setSelectedAccount(details.value[0] ?? "")}
                value={selectedAccount ? [selectedAccount] : []}
              >
                <ComboboxInput placeholder="Select account..." />
                <ComboboxContent>
                  <ComboboxEmpty>No accounts found.</ComboboxEmpty>
                  {accountCollection.items.map((item) => {
                    const Icon = getProviderIcon(item.provider);
                    return (
                      <ComboboxItem item={item} key={item.value}>
                        {item.label}
                        <Icon className="ms-auto size-3.5 opacity-60" />
                      </ComboboxItem>
                    );
                  })}
                </ComboboxContent>
              </Combobox>
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
                  collection={schemeCollection}
                  onValueChange={(details) =>
                    setSchemeChoice({
                      account: selectedAccount,
                      scheme: details.value[0] ?? "",
                    })
                  }
                  value={selectedScheme ? [selectedScheme] : []}
                >
                  <SelectTrigger
                    className="w-auto shrink-0 rounded-e-none border-e-0 font-mono"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {schemeCollection.items.map((item) => (
                      <SelectItem className="font-mono" item={item} key={item.value}>
                        {item.label}
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
