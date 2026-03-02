"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SettingsPage,
  SettingsSection,
} from "@/components/settings/settings-section";
import { OrgDetailsCard, type OrgDetailsCardHandle } from "@/components/organization/org-details-card";
import {
  CredentialCard,
  formatDate,
} from "@/components/compliance/compliance-view";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function OrgDetailsPage() {
  const queryClient = useQueryClient();
  const { isLoading: identityLoading } = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<OrgDetailsCardHandle>(null);
  const { data: compliance, isLoading: complianceLoading } =
    useQuery({ queryKey: queryKeys.gx.compliance, queryFn: api.gaiax.compliance.status });

  const [rerunLoading, setRerunLoading] = useState(false);

  const isGaiaX = compliance?.compliant === true;
  const loading = identityLoading || complianceLoading;

  async function handleRerun() {
    setRerunLoading(true);
    try {
      await api.gaiax.compliance.rerun();
      await queryClient.invalidateQueries({ queryKey: queryKeys.gx.compliance });
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
      toast.success("Compliance check completed successfully");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Network error. Could not re-run compliance check.",
      );
    } finally {
      setRerunLoading(false);
    }
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            Organization Identity
            {isGaiaX && (
              <Badge className="bg-emerald-600 hover:bg-emerald-700">
                Verified
              </Badge>
            )}
          </span>
        }
        description={
          isGaiaX
            ? "Identity sourced from Gaia-X credentials. Re-run the wizard to update."
            : "Configure your organization identity for catalog generation."
        }
        action={
          isGaiaX
            ? undefined
            : editing
              ? [
                  { label: "Save", onClick: () => cardRef.current?.save(), disabled: saving, loading: saving, loadingLabel: "Saving..." },
                  { label: "Cancel", variant: "ghost" as const, onClick: () => setEditing(false), disabled: saving },
                ]
              : { label: "Edit", icon: <Pencil className="h-4 w-4 mr-1" />, onClick: () => setEditing(true) }
        }
      >
        <OrgDetailsCard ref={cardRef} readOnly={isGaiaX} editing={editing} onEditingChange={setEditing} onSavingChange={setSaving} />
      </SettingsSection>

      <SettingsSection
        title="Gaia-X Compliance"
        description={
          isGaiaX
            ? "Your organization is Gaia-X conformant."
            : "Become a verified Gaia-X participant to join the European data ecosystem."
        }
        action={
          !loading
            ? isGaiaX
              ? { label: "Re-run Check", onClick: handleRerun, loading: rerunLoading, loadingLabel: "Running..." }
              : {
                  label: compliance?.wizard_state?.current_step ? "Continue Wizard" : "Start Wizard",
                  href: "/organization/compliance/wizard",
                }
            : undefined
        }
      >
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : isGaiaX ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-emerald-600" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Conformant</span>
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">
                    Verified
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verified on {formatDate(compliance.verified_at)}
                </p>
              </div>
            </div>

            {compliance.credentials.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Credentials</p>
                {compliance.credentials.map((credential) => (
                  <CredentialCard
                    key={credential.name}
                    credential={credential}
                  />
                ))}
              </div>
            )}

            <Link
              href="/organization/compliance/wizard"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Start wizard again
            </Link>
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-amber-500 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Badge variant="outline">Pending</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Complete the Gaia-X compliance wizard to become a verified
                  participant and unlock credential-based identity.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </SettingsSection>

    </SettingsPage>
  );
}
