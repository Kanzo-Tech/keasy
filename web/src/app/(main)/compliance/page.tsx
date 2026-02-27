"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { ComplianceView } from "@/components/compliance/compliance-view";

interface ComplianceStatus {
  compliant: boolean;
  verified_at: string | null;
  credentials: Array<{
    name: string;
    issued_at: string;
    raw_json: object;
  }>;
  wizard_state?: { current_step?: number };
}

export default function CompliancePage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<ComplianceStatus>(
    "gx-compliance-status",
    () =>
      fetch("/api/compliance/status")
        .then((r) => r.json())
        .then((r) => r.data ?? r)
  );

  useEffect(() => {
    if (!isLoading && data && !data.compliant) {
      router.push("/compliance/wizard");
    }
  }, [isLoading, data, router]);

  if (isLoading || !data) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data.compliant) {
    // Redirect is happening via useEffect — show skeleton while navigating
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-4">
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  return <ComplianceView status={data} />;
}
