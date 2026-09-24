"use client";

import { useRef, useState } from "react";
import { can, useSession } from "@kanzo-tech/auth";
import { Button } from "@kanzo-tech/ui";
import { Pencil } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { OrgDetailsCard, type OrgDetailsCardHandle } from "@/components/organization/org-details-card";

export function OrgDetailsPage() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<OrgDetailsCardHandle>(null);

  // Hides the Edit control for a non-owner. It protects nothing — PUT
  // /v1/org/identity is owner-only and the resource server is what refuses it.
  const { session } = useSession();
  const isOwner = can(session, "owner");

  const actions = !isOwner ? undefined : editing ? (
    <>
      <Button size="sm" variant="outline" isLoading={saving} onClick={() => cardRef.current?.save()}>
        Save
      </Button>
      <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
      <Pencil className="h-4 w-4" />
      Edit
    </Button>
  );

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Organization Identity"
        description="Configure your organization identity for catalog generation."
        actions={actions}
      >
        <OrgDetailsCard ref={cardRef} readOnly={!isOwner} editing={editing} onEditingChange={setEditing} onSavingChange={setSaving} />
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
