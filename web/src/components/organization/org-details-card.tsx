"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/shared/form-layout";
import { COUNTRY_OPTIONS, getCountryName } from "@/lib/countries";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
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
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
    const [editingInternal, setEditingInternal] = useState(false);
    const editing = editingProp ?? editingInternal;
    const setEditing = onEditingChange ?? setEditingInternal;
    const [form, setForm] = useState<OrgIdentity | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (editing && !form) {
        setForm(data ?? { legal_name: "", country: "", registration_number: null, country_subdivision_code: null, registration_number_type: null });
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
        await api.org.saveIdentity(form);
        await queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
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

    /** Extract subdivision suffix from a full ISO 3166-2 code (e.g. "DE-BY" → "BY") */
    function subdivisionSuffix(code: string | null | undefined, country: string): string {
      if (!code) return "";
      const prefix = `${country}-`;
      if (code.startsWith(prefix)) return code.slice(prefix.length);
      const dash = code.indexOf("-");
      return dash >= 0 ? code.slice(dash + 1) : code;
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField label="Legal Name" description="Official registered name">
          <Input
            value={canEdit ? form.legal_name : data?.legal_name ?? ""}
            onChange={(e) => canEdit && setForm({ ...form, legal_name: e.target.value })}
            disabled={!canEdit || saving}
            placeholder="Acme Corp GmbH"
          />
        </FormField>
        <FormField label="Country" description="Subdivision is optional">
          {canEdit ? (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_5rem] gap-1.5 xl:gap-0">
              <Combobox
                options={COUNTRY_OPTIONS}
                value={form.country}
                onValueChange={(v) => {
                  const updates: Partial<OrgIdentity> = { country: v };
                  if (form.country_subdivision_code) {
                    const suffix = subdivisionSuffix(form.country_subdivision_code, form.country);
                    updates.country_subdivision_code = suffix ? `${v}-${suffix}` : null;
                  }
                  setForm({ ...form, ...updates });
                }}
                placeholder="Country..."
                searchPlaceholder="Search countries..."
                emptyMessage="No country found."
                disabled={saving}
                className="xl:rounded-r-none xl:border-r-0 xl:shadow-none"
              />
              <Input
                value={subdivisionSuffix(form.country_subdivision_code, form.country)}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                  setForm({
                    ...form,
                    country_subdivision_code: val ? `${form.country}-${val}` : null,
                  });
                }}
                disabled={!form.country || saving}
                placeholder="BY"
                className="font-mono xl:rounded-l-none"
              />
            </div>
          ) : (
            <Input
              value={
                data?.country
                  ? `${getCountryName(data.country) ?? data.country} (${data.country_subdivision_code ?? data.country})`
                  : ""
              }
              disabled
              placeholder="Not set"
            />
          )}
        </FormField>
        <FormField label="Registration Number" description="VAT ID, LEI Code, or EORI">
          {canEdit ? (
            <div className="grid grid-cols-1 xl:grid-cols-[6rem_1fr] gap-1.5 xl:gap-0">
              <Select
                value={form.registration_number_type ?? ""}
                onValueChange={(v) => setForm({ ...form, registration_number_type: v || null })}
                disabled={saving}
              >
                <SelectTrigger className="w-full xl:rounded-r-none xl:border-r-0 xl:shadow-none">
                  <SelectValue placeholder="Type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vatID">VAT ID</SelectItem>
                  <SelectItem value="leiCode">LEI Code</SelectItem>
                  <SelectItem value="EORI">EORI</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={form.registration_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, registration_number: e.target.value || null })
                }
                disabled={saving}
                placeholder="HRB 12345"
                className="font-mono xl:rounded-l-none"
              />
            </div>
          ) : (
            <Input
              value={
                data?.registration_number
                  ? `${data.registration_number_type ? `${data.registration_number_type}: ` : ""}${data.registration_number}`
                  : ""
              }
              disabled
              placeholder="Not set"
            />
          )}
        </FormField>
      </div>
    );
  },
);
