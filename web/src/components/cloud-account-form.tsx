"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-layout";
import { SchemaForm } from "@/components/schema-form";
import { getProviderIcon } from "@/lib/provider-icons";
import type { ProviderSchema, CloudAccountSummary } from "@/lib/types";

interface CloudAccountFormProps {
  schema: ProviderSchema[];
  account?: CloudAccountSummary | null;
  onSubmit: (data: {
    name: string;
    provider_id: string;
    auth_method?: string;
    fields: Record<string, string>;
  }) => Promise<void>;
  onCancel: () => void;
}

export function CloudAccountForm({ schema, account, onSubmit, onCancel }: CloudAccountFormProps) {
  const isEdit = !!account;
  const [name, setName] = useState(account?.name ?? "");

  return (
    <SchemaForm
      schema={schema}
      getIcon={getProviderIcon}
      initial={account ? {
        provider_id: account.provider_id,
        auth_method: account.auth_method,
        fields: { ...account.fields },
      } : undefined}
      locked={isEdit}
      canSubmit={name.trim().length > 0}
      submitLabel={isEdit ? "Save" : "Create"}
      secondaryAction={
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft size={14} />
          Back
        </Button>
      }
      onSubmit={async (data) => {
        await onSubmit({ name: name.trim(), ...data });
      }}
    >
      <FormField label="Name" required>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production Azure"
          className="h-8 text-sm"
        />
      </FormField>
    </SchemaForm>
  );
}
