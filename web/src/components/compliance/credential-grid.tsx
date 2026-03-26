"use client";

import { useState } from "react";
import type { ComplianceCredential } from "@/lib/types";
import { CredentialCard } from "@/components/compliance/credential-card";
import { CredentialDetailDialog } from "@/components/compliance/credential-detail-dialog";

interface CredentialGridProps {
  credentials: ComplianceCredential[];
}

export function CredentialGrid({ credentials }: CredentialGridProps) {
  const [selected, setSelected] = useState<ComplianceCredential | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {credentials.map((credential) => (
          <CredentialCard
            key={credential.name}
            credential={credential}
            onClick={() => setSelected(credential)}
          />
        ))}
      </div>
      <CredentialDetailDialog
        credential={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
