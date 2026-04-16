"use client";

import { use } from "react";

export default function EditAiProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = use(params);
  return (
    <div className="flex items-center justify-center p-12 text-muted-foreground">
      Edit AI provider "{provider}" — pending schema-driven rewrite
    </div>
  );
}
