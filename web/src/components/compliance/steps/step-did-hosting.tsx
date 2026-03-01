"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { Upload, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface WizardState {
  domain?: string;
  did_document?: object;
  cert_chain_pem?: string;
  current_step?: number;
  [key: string]: unknown;
}

interface StepDidHostingProps {
  onComplete: () => void;
  completed: boolean;
  wizardState: WizardState;
}

function isLocalhostOrPrivateIp(domain: string): boolean {
  if (!domain) return false;
  return (
    domain === "localhost" ||
    domain.startsWith("127.") ||
    domain.startsWith("192.168.") ||
    domain.startsWith("10.") ||
    domain.startsWith("172.") ||
    domain === "::1"
  );
}

export function StepDidHosting({ onComplete, completed, wizardState }: StepDidHostingProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
    cert_count?: number;
  } | null>(null);
  const [didOpen, setDidOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const domain = wizardState.domain ?? "";
  const isLocalDomain = isLocalhostOrPrivateIp(domain);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setValidationResult(null);
    try {
      const text = await file.text();
      const res = await fetch("/v1/gaia-x/wizard/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cert_chain_pem: text, domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? `Validation failed with status ${res.status}`);
      }
      const result = data.data ?? data;
      setValidationResult({
        success: true,
        message: `Certificate chain valid — ${result.cert_count ?? "??"} certificate(s), root CA present`,
        cert_count: result.cert_count,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Certificate validation failed");
      setValidationResult({ success: false, message: error ?? "Validation failed" });
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">DID Document & Certificate</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload your X.509 certificate chain to validate your identity and assemble your DID document.
        </p>
      </div>

      {/* Domain display */}
      {domain && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm">
              <span className="font-medium">Your domain:</span>{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{domain}</code>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Localhost warning */}
      {isLocalDomain && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Your domain appears to be a local or private IP address. Gaia-X requires a publicly
            accessible domain for DID document hosting. The well-known endpoint must be reachable
            from the internet.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Certificate upload */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Certificate Chain (.pem, .crt, .cer)</p>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drag & drop your certificate chain, or <span className="text-primary underline">browse</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Supports .pem, .crt, .cer files</p>
          {loading && <p className="text-sm text-primary mt-2">Validating...</p>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pem,.crt,.cer"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Validation result */}
      {validationResult && (
        <div
          className={`flex items-start gap-2 rounded-md p-3 text-sm ${
            validationResult.success
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {validationResult.success ? (
            <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span>{validationResult.message}</span>
        </div>
      )}

      {/* DID document collapsible */}
      {(completed && wizardState.did_document) && (
        <Collapsible open={didOpen} onOpenChange={setDidOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              {didOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              View DID Document
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 bg-muted rounded-md p-3 text-xs overflow-auto max-h-64 font-mono">
              {JSON.stringify(wizardState.did_document, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
