"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, GalleryVerticalEnd } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { SummaryCard } from "@/components/shared/summary-card";

export function OwnerDashboard() {
  const { data: identity, isLoading: loadingIdentity } = useQuery({
    queryKey: queryKeys.org.identity,
    queryFn: api.org.identity,
  });
  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: queryKeys.settings.catalogStorage,
    queryFn: api.settings.catalogStorage,
  });

  const legalName = identity?.legal_name?.trim();

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Workspace Overview
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            href="/identity"
            icon={Building2}
            title="Identity"
            value={loadingIdentity ? undefined : legalName || "Not set"}
            description="DCAT publisher"
          />
          <SummaryCard
            href="/catalog"
            icon={GalleryVerticalEnd}
            title="Catalog Storage"
            value={loadingCatalog ? undefined : catalog ? "Configured" : "Not set"}
            description="where the catalog is published"
          />
        </div>
      </section>
    </div>
  );
}
