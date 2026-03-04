"use client";

import { ShieldCheck } from "lucide-react";
import type { ComplianceCredential } from "@/lib/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CredentialGrid } from "@/components/compliance/credential-grid";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";
import { formatDate } from "@/lib/formatters";

interface ComplianceViewProps {
  status: {
    compliant: boolean;
    verified_at: string | null;
    credentials: ComplianceCredential[];
  };
}

export function ComplianceView({ status }: ComplianceViewProps) {
  const isConformant = status.compliant;

  return (
    <SettingsPage>
      <SettingsSection title="Compliance Status">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <ShieldCheck className="h-10 w-10 text-emerald-600 shrink-0" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">Gaia-X Conformant</CardTitle>
                <Badge
                  variant={isConformant ? "default" : "destructive"}
                  className={isConformant ? "bg-emerald-600 hover:bg-emerald-700" : undefined}
                >
                  {isConformant ? "Conformant" : "Non-conformant"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Verified on {formatDate(status.verified_at)}
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>
      </SettingsSection>

      <SettingsSection
        title="Credentials"
        description="All generated Gaia-X credentials for your organization."
      >
        <CredentialGrid credentials={status.credentials} />
      </SettingsSection>
    </SettingsPage>
  );
}
