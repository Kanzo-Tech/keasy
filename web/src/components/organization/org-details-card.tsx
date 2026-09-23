"use client";

import { useState, useEffect, useImperativeHandle, useMemo, forwardRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@kanzo-tech/ui";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  createListCollection,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useFilter,
} from "@kanzo-tech/ui";
import { FormField } from "@/components/shared/form-layout";
import { COUNTRY_OPTIONS, getCountryName } from "@/lib/countries";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { OrgIdentity } from "@/lib/types";

const REGISTRATION_TYPES = createListCollection({
  items: [
    { label: "VAT ID", value: "vatID" },
    { label: "LEI Code", value: "leiCode" },
    { label: "EORI", value: "EORI" },
  ],
});

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
    // 250 countries: the collection is derived from the query rather than seeded through
    // `useListCollection`, which would hold its own copy of the list.
    const { contains } = useFilter({ sensitivity: "base" });
    const [countryQuery, setCountryQuery] = useState("");
    const countryCollection = useMemo(
      () =>
        createListCollection({
          items: COUNTRY_OPTIONS.filter((c) => contains(c.label, countryQuery)),
        }),
      [countryQuery, contains],
    );

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
        toast.create({ title: "Organization details saved", type: "success" });
        setEditing(false);
        setForm(null);
      } catch {
        toast.create({ title: "Failed to save organization details", type: "error" });
      } finally {
        updateSaving(false);
      }
    }

    useImperativeHandle(ref, () => ({ save: handleSave }));

    const showSkeleton = useDelayedLoading(isLoading);

    if (isLoading) {
      return showSkeleton ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Legal Name" description="Official registered name">
            <Skeleton className="h-9 w-full" />
          </FormField>
          <FormField label="Country" description="Subdivision is optional">
            <Skeleton className="h-9 w-full" />
          </FormField>
          <FormField label="Registration Number" description="VAT ID, LEI Code, or EORI">
            <Skeleton className="h-9 w-full" />
          </FormField>
        </div>
      ) : null;
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
                collection={countryCollection}
                disabled={saving}
                onInputValueChange={(details) => setCountryQuery(details.inputValue)}
                onValueChange={(details) => {
                  const picked = details.value[0] ?? "";
                  const updates: Partial<OrgIdentity> = { country: picked };
                  if (form.country_subdivision_code) {
                    const suffix = subdivisionSuffix(form.country_subdivision_code, form.country);
                    updates.country_subdivision_code = suffix ? `${picked}-${suffix}` : null;
                  }
                  setForm({ ...form, ...updates });
                }}
                value={form.country ? [form.country] : []}
              >
                <ComboboxInput
                  className="xl:rounded-e-none xl:border-e-0 xl:shadow-none"
                  placeholder="Country..."
                />
                <ComboboxContent>
                  <ComboboxEmpty>No country found.</ComboboxEmpty>
                  {countryCollection.items.map((item) => (
                    <ComboboxItem item={item} key={item.value}>
                      {item.label}
                    </ComboboxItem>
                  ))}
                </ComboboxContent>
              </Combobox>
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
                collection={REGISTRATION_TYPES}
                disabled={saving}
                onValueChange={(details) =>
                  setForm({ ...form, registration_number_type: details.value[0] || null })
                }
                value={form.registration_number_type ? [form.registration_number_type] : []}
              >
                <SelectTrigger className="w-full xl:rounded-e-none xl:border-e-0 xl:shadow-none">
                  <SelectValue placeholder="Type..." />
                </SelectTrigger>
                <SelectContent>
                  {REGISTRATION_TYPES.items.map((item) => (
                    <SelectItem item={item} key={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
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
