"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  createListCollection,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Float,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useFilter,
} from "@kanzo-tech/ui";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import { api } from "@/lib/api";
import { getProviderIcon } from "@/lib/provider-icons";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";
import type { ConnectionKind, LocationType } from "@/lib/types";

/** URL schemes per provider; the first is the default. */
const PROVIDER_SCHEMES: Record<string, string[]> = {
  azure: ["az://", "azure://", "abfss://", "abfs://", "adl://"],
  s3: ["s3://"],
};
const NO_SCHEMES: string[] = [];

const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  azure: "my-container",
  s3: "my-bucket/prefix/",
};

export default function NewConnectionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: ConnectionKind }>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { type = "data" } = use(searchParams);

  const { data } = useQuery({ queryKey: queryKeys.cloud.accounts, queryFn: api.cloud.list });
  // Memoised: a fresh `[]` each render would rebuild every collection below.
  const accounts = useMemo(() => data ?? [], [data]);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConnectionKind>(type);
  const [locationType, setLocationType] = useState<LocationType>("cloud");
  const [accountId, setAccountId] = useState("");
  const [url, setUrl] = useState("");
  // Tagged with the account it was picked for, so switching account falls back to that
  // provider's default scheme without an effect.
  const [schemeChoice, setSchemeChoice] = useState<{ account: string; scheme: string } | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const schemes = useMemo(
    () => (account ? (PROVIDER_SCHEMES[account.provider_id] ?? NO_SCHEMES) : NO_SCHEMES),
    [account],
  );
  const scheme = schemeChoice?.account === accountId ? schemeChoice.scheme : (schemes[0] ?? "");
  const placeholder =
    locationType === "local"
      ? "/data/uploads/project/"
      : ((account && PROVIDER_PLACEHOLDERS[account.provider_id]) ?? "Container URL");

  // Derived from the query rather than seeded through `useListCollection`, whose own state
  // would keep the `[]` of the first render of an async list.
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

  const create = useMutation({
    mutationFn: () =>
      api.connections.create({
        name: name.trim(),
        kind,
        location_type: locationType,
        cloud_account_id: locationType === "cloud" ? accountId : undefined,
        url: locationType === "cloud" ? `${scheme}${url.trim()}` : url.trim(),
      }),
    onSuccess: async () => {
      toast.create({ title: "Connection created", type: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections.all() });
      router.push(`/connections?type=${kind}`);
    },
    onError: (err) => toastError(err, "Failed to create connection"),
  });
  const creating = create.isPending || create.isSuccess;

  useBeforeUnload(!!(name || url || accountId) && !creating);

  const urlInput = (
    <Input
      className="font-mono"
      onChange={(e) => setUrl(e.target.value)}
      placeholder={placeholder}
      value={url}
    />
  );

  return (
    <SectionRoot>
      <SectionBody scale="page">
        <Field required>
          <FieldLabel>
            Name
            <FieldRequiredIndicator />
          </FieldLabel>
          <FieldDescription>
            Used as identifier in @references (e.g. @my-connection/file.csv)
          </FieldDescription>
          <Input onChange={(e) => setName(e.target.value)} placeholder="e.g. hr-data" value={name} />
        </Field>

        <Field required>
          <FieldLabel>
            Type
            <FieldRequiredIndicator />
          </FieldLabel>
          <RadioGroup
            className="*:items-start"
            columns={2}
            onValueChange={(details) => setKind((details.value ?? "data") as ConnectionKind)}
            value={kind}
          >
            <RadioGroupCard className="flex-col gap-1" value="data">
              <RadioGroupText className="font-medium text-sm leading-none">Data</RadioGroupText>
              <span className="text-muted-foreground text-xs">Read/write data for fossil pipelines</span>
            </RadioGroupCard>
            <RadioGroupCard className="flex-col gap-1" value="vocab">
              <RadioGroupText className="font-medium text-sm leading-none">Vocabulary</RadioGroupText>
              <span className="text-muted-foreground text-xs">RDF vocabularies and ontologies</span>
            </RadioGroupCard>
          </RadioGroup>
        </Field>

        <Field required>
          <FieldLabel>
            Location
            <FieldRequiredIndicator />
          </FieldLabel>
          <RadioGroup
            className="*:items-start"
            columns={2}
            onValueChange={(details) => setLocationType((details.value ?? "cloud") as LocationType)}
            value={locationType}
          >
            <RadioGroupCard className="flex-col gap-1" value="cloud">
              <RadioGroupText className="font-medium text-sm leading-none">Cloud</RadioGroupText>
              <span className="text-muted-foreground text-xs">S3 or Azure storage</span>
            </RadioGroupCard>
            {/* `h-full` on both wrappers keeps the gated card as tall as its grid neighbour. */}
            <div className="relative h-full">
              <div className="pointer-events-none h-full opacity-50" inert>
                <RadioGroupCard className="h-full flex-col gap-1" disabled value="local">
                  <RadioGroupText className="font-medium text-sm leading-none">Local</RadioGroupText>
                  <span className="text-muted-foreground text-xs">Local filesystem path</span>
                </RadioGroupCard>
              </div>
              <Float className="-end-2 -top-2" placement="top-end">
                <Badge size="xs">Coming soon</Badge>
              </Float>
            </div>
          </RadioGroup>
        </Field>

        {locationType === "cloud" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field required>
              <FieldLabel>
                Cloud Account
                <FieldRequiredIndicator />
              </FieldLabel>
              {accounts.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No cloud accounts configured.{" "}
                  <Link className="text-primary hover:underline" href="/settings/cloud-accounts">
                    Create one first
                  </Link>
                  .
                </p>
              ) : (
                <Combobox
                  collection={accountCollection}
                  onInputValueChange={(details) => setAccountQuery(details.inputValue)}
                  onValueChange={(details) => setAccountId(details.value[0] ?? "")}
                  value={accountId ? [accountId] : []}
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
            </Field>
            <Field required>
              <FieldLabel>
                URL
                <FieldRequiredIndicator />
              </FieldLabel>
              {schemes.length === 1 ? (
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText className="font-mono">{scheme}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    className="font-mono"
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={placeholder}
                    value={url}
                  />
                </InputGroup>
              ) : schemes.length > 1 ? (
                <div className="flex">
                  <Select
                    collection={schemeCollection}
                    onValueChange={(details) =>
                      setSchemeChoice({ account: accountId, scheme: details.value[0] ?? "" })
                    }
                    value={scheme ? [scheme] : []}
                  >
                    <SelectTrigger className="w-auto shrink-0 rounded-e-none border-e-0 font-mono">
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
                  <Input
                    className="flex-1 rounded-s-none font-mono"
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={placeholder}
                    value={url}
                  />
                </div>
              ) : (
                urlInput
              )}
            </Field>
          </div>
        ) : (
          <Field required>
            <FieldLabel>
              URL
              <FieldRequiredIndicator />
            </FieldLabel>
            {urlInput}
          </Field>
        )}
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button
          disabled={!name.trim() || !url.trim() || (locationType === "cloud" && !accountId)}
          isLoading={creating}
          onClick={() => create.mutate()}
          size="sm"
        >
          Create
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
