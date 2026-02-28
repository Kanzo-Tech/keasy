"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/shared/form-layout";
import { fetchOrgIdentity, saveOrgIdentity } from "@/lib/api";
import type { OrgIdentity } from "@/lib/types";

interface OrgDetailsCardProps {
  readOnly?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function OrgDetailsCard({ readOnly, editing: editingProp, onEditingChange }: OrgDetailsCardProps) {
  const { data, isLoading, mutate } = useSWR("org-identity", fetchOrgIdentity);
  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingProp ?? editingInternal;
  const setEditing = onEditingChange ?? setEditingInternal;
  const [form, setForm] = useState<OrgIdentity | null>(null);
  const [saving, setSaving] = useState(false);

  // Initialize form when editing is triggered externally
  useEffect(() => {
    if (editing && !form) {
      setForm(data ?? { legal_name: "", country: "", registration_number: null });
    }
  }, [editing, form, data]);

  function cancelEdit() {
    setEditing(false);
    setForm(null);
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      await saveOrgIdentity(form);
      await mutate();
      toast.success("Organization details saved");
      setEditing(false);
      setForm(null);
    } catch {
      toast.error("Failed to save organization details");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!readOnly && editing && form) {
    return (
      <div className="space-y-4">
        <FormField label="Legal Name">
          <Input
            value={form.legal_name}
            onChange={(e) =>
              setForm({ ...form, legal_name: e.target.value })
            }
            placeholder="Acme Corp GmbH"
          />
        </FormField>
        <FormField label="Country Code" description="ISO 3166-1 alpha-2 (e.g. DE, FR, US)">
          <Input
            value={form.country}
            onChange={(e) =>
              setForm({ ...form, country: e.target.value.toUpperCase() })
            }
            maxLength={2}
            placeholder="DE"
          />
        </FormField>
        <FormField label="Registration Number" optional>
          <Input
            value={form.registration_number ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                registration_number: e.target.value || null,
              })
            }
            placeholder="HRB 12345"
          />
        </FormField>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" onClick={cancelEdit} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const empty = (
    <span className="text-muted-foreground italic">Not set</span>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="text-muted-foreground">Legal Name</Label>
          <p className="text-sm mt-1">
            {data?.legal_name || empty}
          </p>
        </div>
        <div>
          <Label className="text-muted-foreground">Country</Label>
          <p className="text-sm mt-1">
            {data?.country || empty}
          </p>
        </div>
        <div>
          <Label className="text-muted-foreground">
            Registration Number
          </Label>
          <p className="text-sm mt-1">
            {data?.registration_number || empty}
          </p>
        </div>
      </div>
    </div>
  );
}
