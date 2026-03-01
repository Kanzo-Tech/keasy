"use client";

import { useState } from "react";
import { Key, RotateCcw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StepKeyPairProps {
  onComplete: () => void;
  completed: boolean;
  publicKeyJwk?: object;
}

export function StepKeyPair({ onComplete, completed, publicKeyJwk }: StepKeyPairProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateKeyPair() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/gaia-x/wizard/keys", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Request failed with status ${res.status}`);
      }
      const data = await res.json();
      const pem: string = data.data?.private_key_pem ?? data.private_key_pem;

      // Trigger download of PEM file
      const blob = new Blob([pem], { type: "application/x-pem-file" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "keasy-private-key.pem";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Key Pair Generation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Generate an ECDSA P-256 key pair for signing Gaia-X credentials.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {completed && publicKeyJwk ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4 text-emerald-600" />
              Key pair generated
            </CardTitle>
            <CardDescription>
              Your private key was downloaded. Keep it secure — it is not stored on the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Public Key (JWK)
              </p>
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48 font-mono">
                {JSON.stringify(publicKeyJwk, null, 2)}
              </pre>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={generateKeyPair}
              disabled={loading}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              {loading ? "Regenerating..." : "Regenerate Key Pair"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate an ECDSA P-256 key pair. The private key will be downloaded to your computer
              and will <strong>not</strong> be stored on the server. You will use this private key
              in later steps to sign your credentials.
            </p>
            <Button onClick={generateKeyPair} disabled={loading} className="gap-2">
              <Download className="h-4 w-4" />
              {loading ? "Generating..." : "Generate Key Pair"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
