"use client";

import { use } from "react";
import { CredentialForm } from "../_parts/credential-form";

export default function CredentialPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  return <CredentialForm name={decodeURIComponent(name)} />;
}
