"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { OrgDetailsCard, ORG_IDENTITY_FORM_ID } from "@/components/organization/org-details-card";
import { ComplianceSection, useComply } from "@/components/compliance/compliance-section";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function OrgDetailsPage() {
  const { data: identityData, isLoading: identityLoading } = useQuery({
    queryKey: queryKeys.org.identity,
    queryFn: api.org.identity,
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: compliance } = useQuery({
    queryKey: queryKeys.gx.compliance,
    queryFn: api.gaiax.compliance.status,
  });

  const isGaiaX = compliance?.compliant === true;
  const comply = useComply(identityData);

  const complianceDescription = isGaiaX
    ? "Your organization is Gaia-X conformant."
    : comply.ready
      ? "Your organization identity is complete. Click to become Gaia-X compliant."
      : "Fill in the organization identity above to become Gaia-X compliant.";

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Organization Identity"
        description={
          isGaiaX
            ? "Identity sourced from Gaia-X credentials."
            : "Configure your organization identity for catalog generation."
        }
        action={
          isGaiaX
            ? undefined
            : !editing
              ? { label: "Edit", icon: <Pencil className="h-4 w-4 mr-1" />, onClick: () => setEditing(true) }
              : undefined
        }
        actionSlot={
          isGaiaX || !editing
            ? undefined
            : (
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  form={ORG_IDENTITY_FORM_ID}
                  size="sm"
                  variant="outline"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            )
        }
      >
        <OrgDetailsCard readOnly={isGaiaX} editing={editing} onEditingChange={setEditing} onSavingChange={setSaving} />
      </SettingsSection>

      <SettingsSection
        title="Gaia-X Compliance"
        description={complianceDescription}
        action={
          isGaiaX
            ? undefined
            : {
                label: "Become Compliant",
                onClick: comply.comply,
                disabled: !comply.ready || comply.isRunning,
                loading: comply.isRunning,
                loadingLabel: "Running...",
                tooltip: comply.ready
                  ? undefined
                  : `Missing: ${comply.missingFields.join(", ")}`,
              }
        }
        actionSlot={
          isGaiaX
            ? <Badge className="bg-emerald-600 hover:bg-emerald-700">Verified</Badge>
            : undefined
        }
      >
        <ComplianceSection identity={identityData} identityLoading={identityLoading} comply={comply} />
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
