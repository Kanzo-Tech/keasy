"use client";

import { useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Field,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Skeleton,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { useBeforeUnload } from "@/hooks/use-before-unload";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import type { Schemas } from "@/lib/api/client";
import { getProviderIcon } from "@/lib/provider-icons";
import { queryKeys } from "@/lib/query-keys";
import { toastError } from "@/lib/toast-error";

/** Adds a cloud account, or edits `accountId`. */
export function AccountForm({ accountId }: { accountId?: string }) {
  const { data: schema = [], isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.settings.schema,
    queryFn: api.settings.schema,
  });
  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: queryKeys.cloud.detail(accountId ?? ""),
    queryFn: () => api.cloud.get(accountId!),
    enabled: !!accountId,
  });
  const isLoading = schemaLoading || accountLoading;
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <SectionRoot>
        <SectionBody scale="page">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </SectionBody>
      </SectionRoot>
    ) : null;
  }
  if (accountId && !account) notFound();

  return <Form account={account} schema={schema} />;
}

function Form({
  schema,
  account,
}: {
  schema: Schemas["ProviderSchema"][];
  account?: Schemas["CloudAccountSummary"];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(account?.name ?? "");
  const [providerId, setProviderId] = useState(account?.provider_id ?? "");
  const [authChoice, setAuthChoice] = useState(account?.auth_method ?? "");
  const [fields, setFields] = useState<Record<string, string>>(account?.fields ?? {});

  const provider = schema.find((s) => s.id === providerId);
  const authMethod = authChoice || provider?.auth_methods[0]?.name || "";
  const activeFields = [
    ...(provider?.common_fields ?? []),
    ...(provider?.auth_methods.find((a) => a.name === authMethod)?.fields ?? []),
  ];
  const defaults = Object.fromEntries(
    activeFields.flatMap((f) => (f.default_value ? [[f.name, f.default_value]] : [])),
  );
  const values: Record<string, string> = { ...defaults, ...fields };
  const valid =
    !!provider &&
    !!name.trim() &&
    activeFields.every((f) => f.optional || (f.secret && account) || values[f.name]?.trim());

  const save = useMutation({
    mutationFn: () => {
      const request = {
        name: name.trim(),
        auth_method: provider?.auth_methods.length ? authMethod : undefined,
        fields: values,
      };
      return account
        ? api.cloud.update(account.id, request)
        : api.cloud.create({ ...request, provider_id: providerId });
    },
    onSuccess: async () => {
      toast.create({ title: account ? "Cloud account updated" : "Cloud account created", type: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.cloud.accounts });
      router.push("/settings/cloud-accounts");
    },
    onError: (err) => toastError(err, account ? "Failed to update" : "Failed to create"),
  });
  const saving = save.isPending || save.isSuccess;

  useBeforeUnload((account ? name !== account.name : !!(name || providerId)) && !saving);

  return (
    <SectionRoot>
      <SectionBody scale="page">
        {account ? (
          <Badge className="w-fit" variant="secondary">
            {provider?.label ?? providerId}
          </Badge>
        ) : (
          <RadioGroup
            className="text-center *:flex-col *:items-center *:justify-center"
            columns={3}
            onValueChange={(details) => {
              setProviderId(details.value ?? "");
              setAuthChoice("");
              setFields({});
            }}
            value={providerId}
          >
            {schema.map((p) => {
              const Icon = getProviderIcon(p.icon);
              return (
                <RadioGroupCard key={p.id} value={p.id}>
                  <Icon className="size-6 shrink-0 text-muted-foreground" />
                  <RadioGroupText>{p.label}</RadioGroupText>
                </RadioGroupCard>
              );
            })}
          </RadioGroup>
        )}

        <Field required>
          <FieldLabel>
            Name
            <FieldRequiredIndicator />
          </FieldLabel>
          <Input
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production Azure"
            value={name}
          />
        </Field>

        {provider && provider.auth_methods.length > 0 && (
          <Field>
            <FieldLabel>Auth Method</FieldLabel>
            <ToggleGroup
              className="w-full"
              multiple={false}
              onValueChange={(details) => {
                if (details.value[0]) setAuthChoice(details.value[0]);
              }}
              value={[authMethod]}
              variant="outline"
            >
              {provider.auth_methods.map((a) => (
                <ToggleGroupItem className="flex-1" key={a.name} value={a.name}>
                  {a.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        )}

        {activeFields.map((f) => (
          <Field key={f.name} required={!f.optional && !(f.secret && account)}>
            <FieldLabel>
              {f.label}
              <FieldRequiredIndicator />
            </FieldLabel>
            {f.secret ? (
              <PasswordInput>
                <PasswordInputGroup>
                  <PasswordInputInput
                    hasStoredValue={!!account}
                    onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })}
                    storedPlaceholder="Leave empty to keep current"
                    value={values[f.name] ?? ""}
                  />
                  <PasswordInputTrigger />
                </PasswordInputGroup>
              </PasswordInput>
            ) : (
              <Input
                onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })}
                value={values[f.name] ?? ""}
              />
            )}
          </Field>
        ))}
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button disabled={!valid} isLoading={saving} onClick={() => save.mutate()} size="sm">
          {account ? "Save" : "Create"}
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
