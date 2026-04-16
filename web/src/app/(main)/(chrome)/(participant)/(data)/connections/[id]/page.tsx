"use client";

import { use } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { ConnectionDetail } from "@/components/connections/connection-detail";

export default function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <PageShell>
      <ConnectionDetail id={id} />
    </PageShell>
  );
}
