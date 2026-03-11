"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CredentialGrid } from "@/components/compliance/credential-grid";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { OrgIdentity } from "@/lib/types";

const PHASES = [
  "Generating keys…",
  "Reading certificates…",
  "Requesting LRN…",
  "Signing credentials…",
  "Submitting to GXDCH…",
  "Complete!",
] as const;

/** Download a PEM string as a file. */
function downloadPem(pem: string) {
  const blob = new Blob([pem], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "private_key.pem";
  a.click();
  URL.revokeObjectURL(url);
}

/** Shared comply state — consumed by ComplianceSection (content) and OrgDetailsPage (header action). */
export function useComply(identity: OrgIdentity | undefined) {
  const queryClient = useQueryClient();
  const [phaseIndex, setPhaseIndex] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const missingFields: string[] = [];
  if (identity) {
    if (!identity.legal_name?.trim()) missingFields.push("Legal Name");
    if (!identity.country_subdivision_code) missingFields.push("Country Subdivision");
    if (!identity.registration_number_type) missingFields.push("Reg. Number Type");
    if (!identity.registration_number) missingFields.push("Registration Number");
  }
  const ready = !!identity && missingFields.length === 0;

  const comply = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    setPhaseIndex(0);

    try {
      for await (const event of api.gaiax.complyStream()) {
        setPhaseIndex(event.index);

        if (event.error) {
          if (event.data?.private_key_pem) downloadPem(event.data.private_key_pem);
          toast.error(event.error);
          queryClient.invalidateQueries({ queryKey: queryKeys.gx.compliance });
          queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
          setTimeout(() => setPhaseIndex(-1), 2000);
          return;
        }

        if (event.phase === "complete" && event.data) {
          if (event.data.compliant && event.data.private_key_pem) {
            downloadPem(event.data.private_key_pem);
            toast.success("Gaia-X compliance achieved! Private key downloaded.");
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.gx.compliance });
          queryClient.invalidateQueries({ queryKey: queryKeys.org.identity });
          setTimeout(() => setPhaseIndex(-1), 2000);
        }
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Network error during compliance check.",
      );
      setPhaseIndex(-1);
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, [queryClient]);

  return {
    comply,
    isRunning,
    ready,
    missingFields,
    phaseIndex,
  };
}

interface ComplianceSectionProps {
  identity: OrgIdentity | undefined;
  identityLoading: boolean;
  comply: ReturnType<typeof useComply>;
}

export function ComplianceSection({ identityLoading, comply }: ComplianceSectionProps) {
  const { data: compliance, isLoading: complianceLoading } = useQuery({
    queryKey: queryKeys.gx.compliance,
    queryFn: api.gaiax.compliance.status,
  });

  const isGaiaX = compliance?.compliant === true;
  const loading = identityLoading || complianceLoading;
  const showSkeleton = useDelayedLoading(loading);

  if (loading) {
    return showSkeleton ? (
      <Skeleton className="h-32 w-full" />
    ) : null;
  }

  // Compliant — show credential cards
  if (isGaiaX && compliance && compliance.credentials.length > 0) {
    return <CredentialGrid credentials={compliance.credentials} />;
  }

  // Running — show progress bar
  if (comply.isRunning && comply.phaseIndex >= 0) {
    const progress = Math.round(((comply.phaseIndex + 1) / PHASES.length) * 100);
    return (
      <div className="space-y-2">
        <Progress value={progress} />
        <p className="text-sm text-muted-foreground">{PHASES[comply.phaseIndex]}</p>
      </div>
    );
  }

  // Pending — nothing to show, description in header handles messaging
  return null;
}
