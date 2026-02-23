import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { getErrorInfo } from "@/lib/error-codes";

export function ErrorAlert({ code }: { code: string }) {
  const { message, link } = getErrorInfo(code);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
      <AlertCircle size={12} className="shrink-0" />
      <span>
        {message}
        {link && (
          <>
            {" "}
            <Link
              href={link.href}
              className="underline text-foreground hover:text-foreground/80"
            >
              {link.label}
            </Link>
          </>
        )}
      </span>
    </div>
  );
}
