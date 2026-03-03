"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ComplianceCredential } from "@/lib/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CredentialCard } from "@/components/compliance/credential-card";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";

/** @deprecated Use ComplianceCredential from @/lib/types directly */
export type Credential = ComplianceCredential;

interface ComplianceViewProps {
  status: {
    compliant: boolean;
    verified_at: string | null;
    credentials: Credential[];
  };
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateStr));
}

export function ComplianceView({ status }: ComplianceViewProps) {
  const [selectedCredential, setSelectedCredential] = useState<ComplianceCredential | null>(null);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {status.credentials.map((credential) => (
            <CredentialCard
              key={credential.name}
              credential={credential}
              onClick={() => setSelectedCredential(credential)}
            />
          ))}
        </div>
      </SettingsSection>

      <Dialog
        open={selectedCredential !== null}
        onOpenChange={(open) => { if (!open) setSelectedCredential(null); }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedCredential && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedCredential.name}</DialogTitle>
                <DialogDescription>
                  Issued on {formatDate(selectedCredential.issued_at)}
                </DialogDescription>
              </DialogHeader>
              <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(selectedCredential.raw_json, null, 2)}
              </pre>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
