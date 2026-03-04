"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/formatters";
import type { ComplianceCredential } from "@/lib/types";

interface CredentialDetailDialogProps {
  credential: ComplianceCredential | null;
  onClose: () => void;
}

export function CredentialDetailDialog({ credential, onClose }: CredentialDetailDialogProps) {
  return (
    <Dialog
      open={credential !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        {credential && (
          <>
            <DialogHeader>
              <DialogTitle>{credential.name}</DialogTitle>
              <DialogDescription>
                Issued on {formatDate(credential.issued_at)}
              </DialogDescription>
            </DialogHeader>
            <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(credential.raw_json, null, 2)}
            </pre>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
