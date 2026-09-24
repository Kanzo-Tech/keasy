"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  Input,
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
  useFilter,
} from "@kanzo-tech/ui";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { COUNTRY_OPTIONS, getCountryName } from "@/lib/countries";
import { queryKeys } from "@/lib/query-keys";
import type { OrgIdentity } from "@/lib/types";

const REGISTRATION_TYPES = createListCollection({
  items: [
    { label: "VAT ID", value: "vatID" },
    { label: "LEI Code", value: "leiCode" },
    { label: "EORI", value: "EORI" },
  ],
});

const BLANK: OrgIdentity = {
  legal_name: "",
  country: "",
  country_subdivision_code: null,
  registration_number: null,
  registration_number_type: null,
};

/** "DE-BY" → "BY": the ISO 3166-2 subdivision without its country. */
function subdivisionSuffix(code: string | null | undefined, country: string) {
  if (!code) return "";
  if (code.startsWith(`${country}-`)) return code.slice(country.length + 1);
  const dash = code.indexOf("-");
  return dash >= 0 ? code.slice(dash + 1) : code;
}

export default function IdentityPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
  const showSkeleton = useDelayedLoading(isLoading);
  // The draft while editing; `null` reads the saved identity back.
  const [form, setForm] = useState<OrgIdentity | null>(null);

  const { contains } = useFilter({ sensitivity: "base" });
  const [countryQuery, setCountryQuery] = useState("");
  const countries = useMemo(
    () => createListCollection({ items: COUNTRY_OPTIONS.filter((c) => contains(c.label, countryQuery)) }),
    [countryQuery, contains],
  );

  const save = useMutation({
    mutationFn: api.org.saveIdentity,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
      toast.create({ title: "Organization details saved", type: "success" });
      setForm(null);
    },
    onError: () => toast.create({ title: "Failed to save organization details", type: "error" }),
  });

  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Organization Identity
          </SectionTitle>
          <SectionDescription>
            Configure your organization identity for catalog generation.
          </SectionDescription>
        </SectionTitleGroup>
        <SectionActions>
          {form ? (
            <>
              <Button isLoading={save.isPending} onClick={() => save.mutate(form)} size="sm" variant="outline">
                Save
              </Button>
              <Button disabled={save.isPending} onClick={() => setForm(null)} size="sm" variant="ghost">
                Cancel
              </Button>
            </>
          ) : (
            <Button disabled={isLoading} onClick={() => setForm(data ?? BLANK)} size="sm" variant="outline">
              <Pencil />
              Edit
            </Button>
          )}
        </SectionActions>
      </SectionHeader>

      <SectionBody scale="page">
        {isLoading ? (
          showSkeleton && <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field disabled={!form || save.isPending}>
              <FieldLabel>Legal Name</FieldLabel>
              <FieldDescription>Official registered name</FieldDescription>
              <Input
                onChange={(e) => form && setForm({ ...form, legal_name: e.target.value })}
                placeholder="Acme Corp GmbH"
                value={form?.legal_name ?? data?.legal_name ?? ""}
              />
            </Field>

            <Field disabled={save.isPending}>
              <FieldLabel>Country</FieldLabel>
              <FieldDescription>Subdivision is optional</FieldDescription>
              {form ? (
                <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[1fr_5rem] xl:gap-0">
                  <Combobox
                    collection={countries}
                    onInputValueChange={(details) => setCountryQuery(details.inputValue)}
                    onValueChange={(details) => {
                      const country = details.value[0] ?? "";
                      const suffix = subdivisionSuffix(form.country_subdivision_code, form.country);
                      setForm({
                        ...form,
                        country,
                        country_subdivision_code: suffix ? `${country}-${suffix}` : null,
                      });
                    }}
                    value={form.country ? [form.country] : []}
                  >
                    <ComboboxInput
                      className="xl:rounded-e-none xl:border-e-0 xl:shadow-none"
                      placeholder="Country..."
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No country found.</ComboboxEmpty>
                      {countries.items.map((item) => (
                        <ComboboxItem item={item} key={item.value}>
                          {item.label}
                        </ComboboxItem>
                      ))}
                    </ComboboxContent>
                  </Combobox>
                  <Input
                    className="font-mono xl:rounded-s-none"
                    disabled={!form.country || save.isPending}
                    onChange={(e) => {
                      const code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                      setForm({ ...form, country_subdivision_code: code ? `${form.country}-${code}` : null });
                    }}
                    placeholder="BY"
                    value={subdivisionSuffix(form.country_subdivision_code, form.country)}
                  />
                </div>
              ) : (
                <Input
                  disabled
                  placeholder="Not set"
                  value={
                    data?.country
                      ? `${getCountryName(data.country) ?? data.country} (${data.country_subdivision_code ?? data.country})`
                      : ""
                  }
                />
              )}
            </Field>

            <Field disabled={save.isPending}>
              <FieldLabel>Registration Number</FieldLabel>
              <FieldDescription>VAT ID, LEI Code, or EORI</FieldDescription>
              {form ? (
                <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[6rem_1fr] xl:gap-0">
                  <Select
                    collection={REGISTRATION_TYPES}
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
                    className="font-mono xl:rounded-s-none"
                    onChange={(e) => setForm({ ...form, registration_number: e.target.value || null })}
                    placeholder="HRB 12345"
                    value={form.registration_number ?? ""}
                  />
                </div>
              ) : (
                <Input
                  disabled
                  placeholder="Not set"
                  value={
                    data?.registration_number
                      ? `${data.registration_number_type ? `${data.registration_number_type}: ` : ""}${data.registration_number}`
                      : ""
                  }
                />
              )}
            </Field>
          </div>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
