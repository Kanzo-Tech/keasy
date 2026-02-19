"use client";

import { useEffect, useState } from "react";

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    import("shiki").then(async ({ codeToHtml, bundledLanguages }) => {
      const effective = lang in bundledLanguages ? lang : "text";
      const theme = localStorage.getItem("preferences:shiki-theme") || "github-dark";
      return codeToHtml(code, { lang: effective, theme });
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  if (!html) return null;

  return (
    <div
      data-shiki
      className="rounded-md flex flex-col flex-1 min-h-0 overflow-y-auto leading-relaxed [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_code]:!whitespace-pre"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
