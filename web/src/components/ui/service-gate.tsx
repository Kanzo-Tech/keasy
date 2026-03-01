"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useServices } from "@/hooks/use-services";
import type { ServiceStatus } from "@/lib/api";

const SERVICE_LABELS: Partial<Record<keyof ServiceStatus, string>> = {
  wallet: "Wallet connection is not configured. Contact your administrator.",
  issuer: "Credential issuer is not configured. Contact your administrator.",
  oidc: "Single sign-on (OIDC) is not configured.",
  gxdch_notary: "GXDCH Notary service is not configured.",
  gxdch_compliance: "GXDCH Compliance service is not configured.",
};

interface Props {
  requires: keyof ServiceStatus | (keyof ServiceStatus)[];
  message?: string;
  children: ReactNode;
}

export function ServiceGate({ requires, message, children }: Props) {
  const { services, isLoading } = useServices();

  if (isLoading) return null;

  const keys = Array.isArray(requires) ? requires : [requires];
  const missing = keys.filter((k) => {
    const v = services[k];
    return v === false || v === null || v === undefined;
  });

  if (missing.length === 0) return <>{children}</>;

  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>Service unavailable</AlertTitle>
      <AlertDescription>
        {message ?? missing.map((k) => SERVICE_LABELS[k] ?? `${k} is not configured.`).join(" ")}
      </AlertDescription>
    </Alert>
  );
}
