"use client";

import { BookOpenCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function CatalogPage() {
  return (
    <EmptyState
      icon={BookOpenCheck}
      title="Catalog of Catalogs"
      description="Aggregate view of DCAT catalogs across all participant organizations. Coming soon."
    />
  );
}
