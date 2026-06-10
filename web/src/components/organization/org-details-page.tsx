"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { OrgDetailsCard, type OrgDetailsCardHandle } from "@/components/organization/org-details-card";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { MeResponse } from "@/lib/types";

export function OrgDetailsPage() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<OrgDetailsCardHandle>(null);

  // Identity is readable by any member but editable only by the owner
  // (PUT /v1/org/identity is owner-only).
  const { data: me } = useQuery<MeResponse>({ queryKey: queryKeys.me, queryFn: api.auth.me });
  const isOwner = me?.effective_role === "owner";

  const action = !isOwner
    ? undefined
    : editing
      ? [
          { label: "Save", onClick: () => cardRef.current?.save(), disabled: saving, loading: saving, loadingLabel: "Saving..." },
          { label: "Cancel", variant: "ghost" as const, onClick: () => setEditing(false), disabled: saving },
        ]
      : { label: "Edit", icon: <Pencil className="h-4 w-4 mr-1" />, onClick: () => setEditing(true) };

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Organization Identity"
        description="Configure your organization identity for catalog generation."
        action={action}
      >
        <OrgDetailsCard ref={cardRef} readOnly={!isOwner} editing={editing} onEditingChange={setEditing} onSavingChange={setSaving} />
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
