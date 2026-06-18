"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

/// Mirror the control-plane's slugify so the previewed handle matches the
/// subdomain that will actually be created.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function OnboardPage() {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  // The last completed availability check, keyed by the handle it was for. State
  // is only ever set from the async debounce callback (never synchronously in the
  // effect), and the live status is derived from it below.
  const [checked, setChecked] = useState<{ handle: string; available: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the handle in sync with the name until the user edits it directly.
  const effectiveHandle = handleEdited ? slugify(handle) : slugify(name);

  const availability: "idle" | "checking" | "available" | "taken" = !effectiveHandle
    ? "idle"
    : checked?.handle === effectiveHandle
      ? checked.available
        ? "available"
        : "taken"
      : "checking";

  // Debounced availability check — the user never submits a taken handle.
  useEffect(() => {
    if (!effectiveHandle || checked?.handle === effectiveHandle) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api.auth.checkHandle(effectiveHandle);
        if (!cancelled) setChecked({ handle: effectiveHandle, available: res.available });
      } catch {
        if (!cancelled) setChecked({ handle: effectiveHandle, available: false });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [effectiveHandle, checked]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || availability !== "available") return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await api.auth.onboard(name.trim(), effectiveHandle);
      // Land in the new workspace as owner (its OIDC flow issues the keasy:role).
      window.location.assign(`${url}/v1/auth/oidc-start`);
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof ApiError && err.code === "auth/validation_failed"
          ? "That handle is taken. Try another."
          : "Could not create your workspace. Please try again."
      );
    }
  }

  const canSubmit =
    name.trim().length > 0 && availability === "available" && !submitting;

  return (
    <div className="flex min-h-full items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
          <CardDescription>
            Name it and pick a handle — you&apos;ll be its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ws-handle">Handle</Label>
              <Input
                id="ws-handle"
                value={handleEdited ? handle : slugify(name)}
                onChange={(e) => {
                  setHandleEdited(true);
                  setHandle(e.target.value);
                }}
                placeholder="acme"
                autoCapitalize="none"
                spellCheck={false}
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {effectiveHandle ? (
                  <>
                    <span className="truncate">{effectiveHandle}.&hellip;</span>
                    {availability === "checking" && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {availability === "available" && (
                      <Check className="h-3 w-3 text-green-600" />
                    )}
                    {availability === "taken" && (
                      <span className="flex items-center gap-1 text-destructive">
                        <X className="h-3 w-3" /> taken
                      </span>
                    )}
                  </>
                ) : (
                  "Your workspace will live at this subdomain."
                )}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={!canSubmit} className="w-full">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create workspace"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
