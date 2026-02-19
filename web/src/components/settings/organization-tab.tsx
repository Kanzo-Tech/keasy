"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAsync } from "@/hooks/use-async";
import { useMutation } from "@/hooks/use-mutation";
import { fetchOrgSettings, saveOrgSettings } from "@/lib/api";
import { FormField, FormActions } from "@/components/form-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { OrgSettings } from "@/lib/types";

export function OrganizationTab() {
  const [publisherName, setPublisherName] = useState("");
  const [publisherUri, setPublisherUri] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [licenseUri, setLicenseUri] = useState("");
  const [catalogDescription, setCatalogDescription] = useState("");

  const { loading } = useAsync(async () => {
    const settings = await fetchOrgSettings();
    if (settings) {
      setPublisherName(settings.publisher_name || "");
      setPublisherUri(settings.publisher_uri || "");
      setContactEmail(settings.contact_email || "");
      setLicenseUri(settings.license_uri || "");
      setCatalogDescription(settings.catalog_description || "");
    }
  }, []);

  const handleSave = useCallback(async () => {
    const settings: OrgSettings = {
      publisher_name: publisherName.trim(),
      publisher_uri: publisherUri.trim() || undefined,
      contact_email: contactEmail.trim() || undefined,
      license_uri: licenseUri.trim() || undefined,
      catalog_description: catalogDescription.trim() || undefined,
    };
    await saveOrgSettings(settings);
    toast.success("Organization settings saved");
  }, [publisherName, publisherUri, contactEmail, licenseUri, catalogDescription]);

  const { mutate, pending: saving } = useMutation(handleSave);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const canSave = publisherName.trim().length > 0;

  return (
    <div className="space-y-4">
      <FormField
        label="Publisher Name"
        required
        description="The name of the organization that publishes the data."
      >
        <Input
          type="text"
          value={publisherName}
          onChange={(e) => setPublisherName(e.target.value)}
          placeholder="e.g. Acme Corp"
        />
      </FormField>

      <FormField
        label="Publisher URI"
        optional
        description="A URI identifying the publisher in linked data contexts."
      >
        <Input
          type="text"
          value={publisherUri}
          onChange={(e) => setPublisherUri(e.target.value)}
          placeholder="e.g. https://acme.example.org"
        />
      </FormField>

      <FormField
        label="Contact Email"
        optional
        description="Contact point included in generated DCAT catalogs."
      >
        <Input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="e.g. data@acme.example.org"
        />
      </FormField>

      <FormField
        label="License URI"
        optional
        description="Default license applied to datasets in generated catalogs."
      >
        <Input
          type="text"
          value={licenseUri}
          onChange={(e) => setLicenseUri(e.target.value)}
          placeholder="e.g. https://creativecommons.org/licenses/by/4.0/"
        />
      </FormField>

      <FormField
        label="Catalog Description"
        optional
        description="Brief description embedded in generated DCAT catalog metadata."
      >
        <Textarea
          value={catalogDescription}
          onChange={(e) => setCatalogDescription(e.target.value)}
          placeholder="Brief description for generated DCAT catalogs"
          rows={3}
        />
      </FormField>

      <FormActions>
        <div />
        <Button onClick={() => mutate()} disabled={!canSave || saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </FormActions>
    </div>
  );
}
