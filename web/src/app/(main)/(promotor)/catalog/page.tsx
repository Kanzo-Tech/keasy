"use client";

import { BookOpenCheck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export default function CatalogPage() {
  return (
    <div className="flex-1 overflow-auto p-4">
      <EmptyState
        icon={BookOpenCheck}
        title="Catalog of Catalogs"
        description="Aggregate view of DCAT catalogs across all participant organizations. Coming soon."
      />
    </div>
  );
}
