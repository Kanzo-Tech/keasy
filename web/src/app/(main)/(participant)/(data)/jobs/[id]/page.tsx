"use client";

import { use } from "react";
import { PageContent } from "@/components/layout/page-content";
import { JobDetailView } from "@/components/jobs/job-detail-view";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <PageContent className="flex flex-col gap-4 overflow-hidden">
      <JobDetailView id={id} />
    </PageContent>
  );
}
