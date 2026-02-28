"use client";

import { use } from "react";
import { JobDetailView } from "@/components/job-detail-view";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <JobDetailView id={id} />;
}
