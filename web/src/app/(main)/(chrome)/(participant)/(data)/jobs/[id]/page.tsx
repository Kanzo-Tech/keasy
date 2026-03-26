"use client";

import { use } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { JobDetailView } from "@/components/jobs/job-detail-view";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <PageShell>
      <JobDetailView id={id} />
    </PageShell>
  );
}
