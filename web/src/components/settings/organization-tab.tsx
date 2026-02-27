"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ShieldCheck } from "lucide-react";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { useMutation } from "@/hooks/use-mutation";
import { fetchOrgSettings, saveOrgSettings } from "@/lib/api";
import { SettingsSection, SettingsPage } from "@/components/settings/settings-section";
import { FormField, FormActions } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { OrgSettings } from "@/lib/types";

type MeResponse = {
  org: { vc_verified_at?: string | null } | null;
};

export function OrganizationTab() {
  const { data: settings, isLoading, mutate } = useSWR("org-settings", fetchOrgSettings);
  const { data: meData } = useSWR<MeResponse>("auth-me", () =>
    fetch("/api/auth/me").then((r) => r.json()).then((r) => r.data ?? r)
  );
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <div className="space-y-6 max-w-2xl">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    ) : null;
  }

  return (
    <OrgForm
      settings={settings ?? { publisher_name: "" }}
      vcVerifiedAt={meData?.org?.vc_verified_at ?? null}
      onSaved={() => mutate()}
    />
  );
}

function OrgForm({
  settings,
  vcVerifiedAt,
  onSaved,
}: {
  settings: OrgSettings;
  vcVerifiedAt?: string | null;
  onSaved: () => void;
}) {
  const [publisherName, setPublisherName] = useState(settings.publisher_name || "");
  const [publisherUri, setPublisherUri] = useState(settings.publisher_uri || "");
  const [contactEmail, setContactEmail] = useState(settings.contact_email || "");
  const [licenseUri, setLicenseUri] = useState(settings.license_uri || "");
  const [catalogDescription, setCatalogDescription] = useState(settings.catalog_description || "");

  const handleSave = useCallback(async () => {
    const s: OrgSettings = {
      publisher_name: publisherName.trim(),
      publisher_uri: publisherUri.trim() || undefined,
      contact_email: contactEmail.trim() || undefined,
      license_uri: licenseUri.trim() || undefined,
      catalog_description: catalogDescription.trim() || undefined,
    };
    await saveOrgSettings(s);
    onSaved();
    toast.success("Organization settings saved");
  }, [publisherName, publisherUri, contactEmail, licenseUri, catalogDescription, onSaved]);

  const { mutate: save, pending: saving } = useMutation(handleSave);

  const canSave = publisherName.trim().length > 0;

  return (
    <SettingsPage>
      {vcVerifiedAt && (
        <SettingsSection
          title="VC Compliance"
          description="Verifiable Credential verification status for this organization."
        >
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>
              Verified on{" "}
              <time dateTime={vcVerifiedAt}>
                {new Date(vcVerifiedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </span>
          </div>
        </SettingsSection>
      )}
      <SettingsSection
        title="Publisher"
        description="Identity of the organization that publishes data. Used in generated DCAT catalogs."
      >
        <div className="space-y-3">
          <FormField label="Name" required>
            <Input
              value={publisherName}
              onChange={(e) => setPublisherName(e.target.value)}
              placeholder="e.g. Acme Corp"
            />
          </FormField>
          <FormField label="URI" description="Linked data identifier for the publisher.">
            <Input
              value={publisherUri}
              onChange={(e) => setPublisherUri(e.target.value)}
              placeholder="e.g. https://acme.example.org"
            />
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Contact"
        description="Contact point included in generated catalogs."
      >
        <FormField label="Email">
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="e.g. data@acme.example.org"
          />
        </FormField>
      </SettingsSection>

      <SettingsSection
        title="Catalog defaults"
        description="Default metadata applied to all generated DCAT catalogs."
      >
        <div className="space-y-3">
          <FormField label="License URI">
            <Input
              value={licenseUri}
              onChange={(e) => setLicenseUri(e.target.value)}
              placeholder="e.g. https://creativecommons.org/licenses/by/4.0/"
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={catalogDescription}
              onChange={(e) => setCatalogDescription(e.target.value)}
              placeholder="Brief description for generated catalogs"
              rows={3}
            />
          </FormField>
        </div>
      </SettingsSection>

      <FormActions sticky>
        <div />
        <Button onClick={() => save()} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </FormActions>
    </SettingsPage>
  );
}
