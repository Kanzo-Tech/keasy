"use client";

import { use } from "react";
import type { Purpose } from "@/lib/connections";
import { CredentialForm } from "../_parts/credential-form";

export default function NewCredentialPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: Purpose }>;
}) {
  const { purpose = "storage" } = use(searchParams);
  return <CredentialForm purpose={purpose} />;
}
