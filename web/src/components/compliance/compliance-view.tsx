"use client";

import { useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { ShieldCheck, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ComplianceCredential } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

export function CredentialCard({ credential }: { credential: Credential }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              {credential.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Issued on {formatDate(credential.issued_at)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 px-0 h-auto text-xs text-muted-foreground hover:text-foreground">
              View Raw JSON
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto mt-2 whitespace-pre-wrap break-all">
              {JSON.stringify(credential.raw_json, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function ComplianceView({ status }: ComplianceViewProps) {
  const { mutate } = useSWRConfig();
  const [rerunLoading, setRerunLoading] = useState(false);

  const isConformant = status.compliant;

  async function handleRerun() {
    setRerunLoading(true);
    try {
      await api.gaiax.compliance.rerun();
      // Refresh compliance status in SWR cache
      await mutate("gx-compliance-status");
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
      <SettingsSection title="Compliance Status">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
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
            <Button
              variant="outline"
              onClick={handleRerun}
              disabled={rerunLoading}
              className="shrink-0"
            >
              {rerunLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                "Re-run Compliance Check"
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>
      </SettingsSection>

      <SettingsSection
        title="Credentials"
        description="All generated Gaia-X credentials for your organization."
      >
        <div className="space-y-3">
          {status.credentials.map((credential) => (
            <CredentialCard key={credential.name} credential={credential} />
          ))}
        </div>
      </SettingsSection>

      <div className="text-center pt-4 border-t">
        <p className="text-sm text-muted-foreground">
          Need to update credentials?{" "}
          <Link
            href="/organization/compliance/wizard"
            className="text-primary underline-offset-4 hover:underline"
          >
            Start the wizard again
          </Link>
        </p>
      </div>
    </SettingsPage>
  );
}
