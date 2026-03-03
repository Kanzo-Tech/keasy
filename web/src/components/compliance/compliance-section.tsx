"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, AlertTriangle, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CredentialCard,
  formatDate,
} from "@/components/compliance/compliance-view";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { OrgIdentity, ComplyResponse } from "@/lib/types";

const PHASES = [
  "Generating keys...",
  "Reading certificates...",
  "Requesting LRN...",
  "Signing credentials...",
  "Submitting to GXDCH...",
  "Complete!",
] as const;

interface ComplianceSectionProps {
  identity: OrgIdentity | undefined;
  identityLoading: boolean;
}

export function ComplianceSection({ identity, identityLoading }: ComplianceSectionProps) {
  const queryClient = useQueryClient();
  const [phaseIndex, setPhaseIndex] = useState(-1);

  const { data: compliance, isLoading: complianceLoading } = useQuery({
    queryKey: queryKeys.gx.compliance,
    queryFn: api.gaiax.compliance.status,
  });

  const complyMutation = useMutation({
    mutationFn: async () => {
      setPhaseIndex(0);
      // Simulate progress phases while the request runs
      const interval = setInterval(() => {
        setPhaseIndex((prev) => (prev < PHASES.length - 2 ? prev + 1 : prev));
      }, 2000);

      try {
        const result = await api.gaiax.comply();
        clearInterval(interval);
        setPhaseIndex(PHASES.length - 1);
        return result;
      } catch (e) {
        clearInterval(interval);
        throw e;
      }
    },
    onSuccess: (data: ComplyResponse) => {
      if (data.compliant && data.private_key_pem) {
        // Auto-download private key
        const blob = new Blob([data.private_key_pem], { type: "application/x-pem-file" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "private_key.pem";
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Gaia-X compliance achieved! Private key downloaded.");
      } else if (!data.compliant) {
        // Partial failure — still offer private key download if available
        if (data.private_key_pem) {
          const blob = new Blob([data.private_key_pem], { type: "application/x-pem-file" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "private_key.pem";
          a.click();
          URL.revokeObjectURL(url);
        }
        toast.error(data.error ?? "Compliance check failed");
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.gx.compliance });
      queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
      setTimeout(() => setPhaseIndex(-1), 2000);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "Network error during compliance check."
      );
      setPhaseIndex(-1);
    },
  });

  const isRunning = complyMutation.isPending;
  const isGaiaX = compliance?.compliant === true;
  const loading = identityLoading || complianceLoading;

  // Check prerequisites
  const missingFields: string[] = [];
  if (identity) {
    if (!identity.legal_name?.trim()) missingFields.push("Legal Name");
    if (!identity.country_subdivision_code) missingFields.push("Country Subdivision");
    if (!identity.registration_number_type) missingFields.push("Reg. Number Type");
    if (!identity.registration_number) missingFields.push("Registration Number");
  }
  const ready = identity && missingFields.length === 0;

  if (loading) {
    return <Skeleton className="h-32 w-full" />;
  }

  // State C: Already compliant
  if (isGaiaX && compliance) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Conformant</span>
              <Badge className="bg-emerald-600 hover:bg-emerald-700">Verified</Badge>
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
              <CredentialCard key={credential.name} credential={credential} />
            ))}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => complyMutation.mutate()}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Re-running...
            </>
          ) : (
            "Re-run Compliance Check"
          )}
        </Button>
      </div>
    );
  }

  // State A: Prerequisites missing
  if (!ready) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
          <div>
            <span className="text-sm font-medium">Complete your organization identity first</span>
            <p className="text-sm text-muted-foreground mt-1">
              Missing: {missingFields.join(", ")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // State B: Ready — show comply button (or progress)
  if (isRunning && phaseIndex >= 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          {PHASES.map((label, i) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              {i < phaseIndex ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : i === phaseIndex ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <div className="h-4 w-4" />
              )}
              <span className={i <= phaseIndex ? "text-foreground" : "text-muted-foreground"}>
                {label}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-amber-500 shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status</span>
            <Badge variant="outline">Pending</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Your organization identity is complete. Click to become Gaia-X compliant.
          </p>
        </div>
        <Button onClick={() => complyMutation.mutate()} disabled={isRunning}>
          Become Gaia-X Compliant
        </Button>
      </CardContent>
    </Card>
  );
}
