import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Gaia-X Credentials Wizard
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          The Gaia-X Compliance Wizard will guide you through generating
          Verifiable Credentials for your organization — including key pair
          generation, DID document hosting, Legal Participant credentials,
          and GXDCH compliance submission.
        </p>
        <p className="text-sm text-muted-foreground">
          This feature is currently under development and will be available
          in a future update.
        </p>
        <Link
          href="/login/vc"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to VC login
        </Link>
      </div>
    </div>
  );
}
