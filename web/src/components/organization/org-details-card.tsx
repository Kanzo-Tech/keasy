"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/shared/form-layout";
import { COUNTRY_OPTIONS, getCountryName } from "@/lib/countries";
import { fetchOrgIdentity, saveOrgIdentity } from "@/lib/api";
import type { OrgIdentity } from "@/lib/types";

export interface OrgDetailsCardHandle {
  save: () => Promise<void>;
}

interface OrgDetailsCardProps {
  readOnly?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

export const OrgDetailsCard = forwardRef<OrgDetailsCardHandle, OrgDetailsCardProps>(
  function OrgDetailsCard({ readOnly, editing: editingProp, onEditingChange, onSavingChange }, ref) {
    const { data, isLoading, mutate } = useSWR("org-identity", fetchOrgIdentity);
    const [editingInternal, setEditingInternal] = useState(false);
    const editing = editingProp ?? editingInternal;
    const setEditing = onEditingChange ?? setEditingInternal;
    const [form, setForm] = useState<OrgIdentity | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (editing && !form) {
        setForm(data ?? { legal_name: "", country: "", registration_number: null });
      }
      if (!editing) {
        setForm(null);
      }
    }, [editing, form, data]);

    function updateSaving(value: boolean) {
      setSaving(value);
      onSavingChange?.(value);
    }

    async function handleSave() {
      if (!form) return;
      updateSaving(true);
      try {
        await saveOrgIdentity(form);
        await mutate();
        toast.success("Organization details saved");
        setEditing(false);
        setForm(null);
      } catch {
        toast.error("Failed to save organization details");
      } finally {
        updateSaving(false);
      }
    }

    useImperativeHandle(ref, () => ({ save: handleSave }));

    if (isLoading) {
      return <Skeleton className="h-24 w-full" />;
    }

    const canEdit = !readOnly && editing && form;

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Legal Name">
          <Input
            value={canEdit ? form.legal_name : data?.legal_name ?? ""}
            onChange={(e) => canEdit && setForm({ ...form, legal_name: e.target.value })}
            disabled={!canEdit || saving}
            placeholder="Acme Corp GmbH"
          />
        </FormField>
        <FormField label="Country">
          {canEdit ? (
            <Combobox
              options={COUNTRY_OPTIONS}
              value={form.country}
              onValueChange={(v) => setForm({ ...form, country: v })}
              placeholder="Select country..."
              searchPlaceholder="Search countries..."
              emptyMessage="No country found."
              disabled={saving}
            />
          ) : (
            <Input
              value={data?.country ? `${getCountryName(data.country) ?? data.country} (${data.country})` : ""}
              disabled
              placeholder="Not set"
            />
          )}
        </FormField>
        <FormField label="Registration Number" optional>
          <Input
            value={canEdit ? (form.registration_number ?? "") : (data?.registration_number ?? "")}
            onChange={(e) =>
              canEdit && setForm({ ...form, registration_number: e.target.value || null })
            }
            disabled={!canEdit || saving}
            placeholder="HRB 12345"
          />
        </FormField>
      </div>
    );
  },
);
