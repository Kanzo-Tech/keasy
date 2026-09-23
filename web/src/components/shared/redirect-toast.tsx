'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from "@kanzo-tech/ui";

function RedirectToastInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get('redirected') === '1') {
      toast.create({ title: "You don't have access to that page.", type: "info" });
      const url = new URL(window.location.href);
      url.searchParams.delete('redirected');
      router.replace(url.pathname + (url.search || ''), { scroll: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function RedirectToast() {
  return (
    <Suspense>
      <RedirectToastInner />
    </Suspense>
  );
}
