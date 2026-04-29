"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
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
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { COUNTRY_OPTIONS, getCountryName } from "@/lib/countries";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  REGISTRATION_NUMBER_TYPES,
  REGISTRATION_NUMBER_TYPE_LABELS,
} from "@/lib/constants/enums";

/* ---------- Schema ---------- */

const orgIdentitySchema = z.object({
  legal_name: z.string().min(1, "Legal name is required"),
  country: z.string().length(2, "Country code required"),
  country_subdivision_code: z.string().nullable().optional(),
  registration_number_type: z
    .enum(REGISTRATION_NUMBER_TYPES as readonly [string, ...string[]])
    .nullable()
    .optional(),
  registration_number: z.string().nullable().optional(),
});

type OrgIdentityFormValues = z.infer<typeof orgIdentitySchema>;

/* ---------- Constants ---------- */

const FORM_ID = "org-identity-form";

/* ---------- Helpers ---------- */

/** Extract subdivision suffix from a full ISO 3166-2 code (e.g. "DE-BY" -> "BY") */
function subdivisionSuffix(code: string | null | undefined, country: string): string {
  if (!code) return "";
  const prefix = `${country}-`;
  if (code.startsWith(prefix)) return code.slice(prefix.length);
  const dash = code.indexOf("-");
  return dash >= 0 ? code.slice(dash + 1) : code;
}

/* ---------- Component ---------- */

interface OrgDetailsCardProps {
  readOnly?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

export { FORM_ID as ORG_IDENTITY_FORM_ID };

export function OrgDetailsCard({
  readOnly,
  editing,
  onEditingChange,
  onSavingChange,
}: OrgDetailsCardProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.org.identity,
    queryFn: api.org.identity,
  });

  const form = useForm<OrgIdentityFormValues>({
    resolver: zodResolver(orgIdentitySchema),
    defaultValues: {
      legal_name: "",
      country: "",
      country_subdivision_code: null,
      registration_number_type: null,
      registration_number: null,
    },
  });

  const { formState: { isSubmitting } } = form;

  // Sync saving state to parent
  useEffect(() => {
    onSavingChange?.(isSubmitting);
  }, [isSubmitting, onSavingChange]);

  // Reset form when entering edit mode
  useEffect(() => {
    if (editing && data) {
      form.reset({
        legal_name: data.legal_name ?? "",
        country: data.country ?? "",
        country_subdivision_code: data.country_subdivision_code ?? null,
        registration_number_type: (data.registration_number_type as OrgIdentityFormValues["registration_number_type"]) ?? null,
        registration_number: data.registration_number ?? null,
      });
    }
  }, [editing, data, form]);

  async function handleSave(values: OrgIdentityFormValues) {
    try {
      await api.org.saveIdentity(values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
      toast.success("Organization details saved");
      onEditingChange?.(false);
    } catch {
      toast.error("Failed to save organization details");
    }
  }

  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field>
          <FieldLabel>Legal Name</FieldLabel>
          <Skeleton loading className="block w-full"><Input disabled placeholder="" /></Skeleton>
          <FieldDescription>Official registered name</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Country</FieldLabel>
          <Skeleton loading className="block w-full"><Input disabled placeholder="" /></Skeleton>
          <FieldDescription>Subdivision is optional</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Registration Number</FieldLabel>
          <Skeleton loading className="block w-full"><Input disabled placeholder="" /></Skeleton>
          <FieldDescription>VAT ID, LEI Code, or EORI</FieldDescription>
        </Field>
      </div>
    ) : null;
  }

  const canEdit = !readOnly && editing;

  return (
    <form
      id={FORM_ID}
      onSubmit={form.handleSubmit(handleSave)}
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      {/* Legal Name */}
      <Controller
        control={form.control}
        name="legal_name"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel>Legal Name</FieldLabel>
            {canEdit ? (
              <Input
                {...field}
                disabled={isSubmitting}
                placeholder="Acme Corp GmbH"
                aria-invalid={fieldState.invalid}
              />
            ) : (
              <Input
                value={data?.legal_name ?? ""}
                disabled
                placeholder="Not set"
              />
            )}
            <FieldDescription>Official registered name</FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />

      {/* Country */}
      <Controller
        control={form.control}
        name="country"
        render={({ fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel>Country</FieldLabel>
            {canEdit ? (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_5rem] gap-1.5 xl:gap-0">
                <Controller
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <Combobox
                      options={COUNTRY_OPTIONS}
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Rewrite subdivision prefix when country changes
                        const currentSub = form.getValues("country_subdivision_code");
                        if (currentSub) {
                          const suffix = subdivisionSuffix(currentSub, field.value);
                          form.setValue(
                            "country_subdivision_code",
                            suffix ? `${v}-${suffix}` : null,
                          );
                        }
                      }}
                      placeholder="Country..."
                      searchPlaceholder="Search countries..."
                      emptyMessage="No country found."
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      className="xl:rounded-r-none xl:border-r-0 xl:shadow-none"
                    />
                  )}
                />
                <Controller
                  control={form.control}
                  name="country_subdivision_code"
                  render={({ field }) => {
                    const country = form.watch("country");
                    return (
                      <Input
                        value={subdivisionSuffix(field.value, country)}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                          field.onChange(val ? `${country}-${val}` : null);
                        }}
                        disabled={!country || isSubmitting}
                        placeholder="BY"
                        className="font-mono xl:rounded-l-none"
                      />
                    );
                  }}
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
            <FieldDescription>Subdivision is optional</FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />

      {/* Registration Number */}
      <Controller
        control={form.control}
        name="registration_number"
        render={({ fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel>Registration Number</FieldLabel>
            {canEdit ? (
              <div className="grid grid-cols-1 xl:grid-cols-[6rem_1fr] gap-1.5 xl:gap-0">
                <Controller
                  control={form.control}
                  name="registration_number_type"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || null)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger className="w-full xl:rounded-r-none xl:border-r-0 xl:shadow-none">
                        <SelectValue placeholder="Type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {REGISTRATION_NUMBER_TYPES.map((rnt) => (
                          <SelectItem key={rnt} value={rnt}>
                            {REGISTRATION_NUMBER_TYPE_LABELS[rnt]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <Controller
                  control={form.control}
                  name="registration_number"
                  render={({ field }) => (
                    <Input
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      disabled={isSubmitting}
                      placeholder="HRB 12345"
                      aria-invalid={fieldState.invalid}
                      className="font-mono xl:rounded-l-none"
                    />
                  )}
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
            <FieldDescription>VAT ID, LEI Code, or EORI</FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
    </form>
  );
}
