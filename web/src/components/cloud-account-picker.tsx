"use client";

import Link from "next/link";
import { Toggle } from "@/components/ui/toggle";
import { getProviderIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import type { ProviderSchema, CloudAccountSummary } from "@/lib/types";

interface CloudAccountPickerProps {
  schema: ProviderSchema[];
  accounts: CloudAccountSummary[];
  value: string[];
  onChange: (value: string[]) => void;
  /** When true, only one account can be selected at a time. */
  single?: boolean;
}

export function CloudAccountPicker({
  schema,
  accounts,
  value,
  onChange,
  single,
}: CloudAccountPickerProps) {
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No cloud accounts configured.{" "}
        <Link href="/settings?tab=cloud-accounts" className="text-primary hover:underline">
          Create one first
        </Link>
        .
      </p>
    );
  }

  function toggle(id: string) {
    if (single) {
      onChange(value.includes(id) ? [] : [id]);
    } else {
      onChange(
        value.includes(id)
          ? value.filter((x) => x !== id)
          : [...value, id],
      );
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map((account) => {
        const provider = schema.find((s) => s.id === account.provider_id);
        const Icon = provider ? getProviderIcon(provider.icon) : null;
        const selected = value.includes(account.id);
        return (
          <Toggle
            key={account.id}
            variant="outline"
            size="sm"
            pressed={selected}
            onPressedChange={() => toggle(account.id)}
            className={cn(
              "gap-2",
              selected && "border-primary bg-accent text-accent-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {account.name}
          </Toggle>
        );
      })}
    </div>
  );
}
