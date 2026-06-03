"use client";

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";
import { OrgDetailsCard, type OrgDetailsCardHandle } from "@/components/organization/org-details-card";

export function OrgDetailsPage() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<OrgDetailsCardHandle>(null);

  return (
    <PageShell>
    <PageShell.Content className="gap-8">
      <SettingsSection
        title="Organization Identity"
        description="Configure your organization identity for catalog generation."
        action={
          editing
            ? [
                { label: "Save", onClick: () => cardRef.current?.save(), disabled: saving, loading: saving, loadingLabel: "Saving..." },
                { label: "Cancel", variant: "ghost" as const, onClick: () => setEditing(false), disabled: saving },
              ]
            : { label: "Edit", icon: <Pencil className="h-4 w-4 mr-1" />, onClick: () => setEditing(true) }
        }
      >
        <OrgDetailsCard ref={cardRef} editing={editing} onEditingChange={setEditing} onSavingChange={setSaving} />
      </SettingsSection>
    </PageShell.Content>
    </PageShell>
  );
}
