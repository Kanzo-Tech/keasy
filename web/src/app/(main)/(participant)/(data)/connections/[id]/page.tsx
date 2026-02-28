"use client";

import { use } from "react";
import { ConnectionDetail } from "@/components/connections/connection-detail";

export default function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ConnectionDetail id={id} />;
}
