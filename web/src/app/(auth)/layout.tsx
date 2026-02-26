import type { Metadata } from "next";
import { Database } from "lucide-react";

export const metadata: Metadata = {
  title: "Authentication | Keasy",
  description: "Authentication pages",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel — branding (hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-10 text-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
            <Database className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Keasy</h1>
        </div>
        <p className="text-slate-300 text-lg leading-relaxed max-w-xs">
          Manage your data pipelines with confidence.
        </p>
        <p className="mt-4 text-slate-400 text-sm">
          Connect, transform, and publish your data assets to standards-compliant data spaces.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
