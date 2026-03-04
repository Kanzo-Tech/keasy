"use client";

import { FileCheck, FileText, ShieldCheck, User } from "lucide-react";
import type { ComplianceCredential } from "@/lib/types";
import { formatDate } from "@/lib/formatters";

const CARD_ICONS: Record<string, typeof FileCheck> = {
  "LRN Credential": FileCheck,
  "Legal Participant Credential": User,
  "Terms & Conditions Credential": FileText,
  "Compliance VC": ShieldCheck,
};

function truncateDid(did: string, maxLen = 24): string {
  if (did.length <= maxLen) return did;
  return did.slice(0, maxLen - 3) + "...";
}

function extractIssuer(raw: Record<string, unknown>): string {
  if (typeof raw.issuer === "string") return raw.issuer;
  if (raw.issuer && typeof (raw.issuer as Record<string, unknown>).id === "string") {
    return (raw.issuer as Record<string, unknown>).id as string;
  }
  const proof = raw.proof as Record<string, unknown> | undefined;
  if (proof && typeof proof.verificationMethod === "string") {
    return proof.verificationMethod;
  }
  return "";
}

interface CredentialCardProps {
  credential: ComplianceCredential;
  onClick: () => void;
}

export function CredentialCard({ credential, onClick }: CredentialCardProps) {
  const Icon = CARD_ICONS[credential.name] ?? FileCheck;
  const issuer = extractIssuer(credential.raw_json as Record<string, unknown>);

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-[1.586/1] w-full rounded-xl bg-primary p-5 text-left text-primary-foreground shadow-md transition-transform hover:scale-[1.02] cursor-pointer flex flex-col justify-between"
    >
      {/* Top-left: icon + name */}
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary-foreground/80 shrink-0" />
        <p className="text-sm font-bold leading-tight truncate">
          {credential.name}
        </p>
      </div>

      {/* Bottom: date + issuer */}
      <div className="flex items-end justify-between gap-2">
        <p className="text-[11px] text-primary-foreground/70">
          {formatDate(credential.issued_at)}
        </p>
        {issuer && (
          <p className="text-[10px] text-primary-foreground/60 text-right shrink-0 max-w-[45%] truncate font-mono">
            {truncateDid(issuer)}
          </p>
        )}
      </div>
    </button>
  );
}
