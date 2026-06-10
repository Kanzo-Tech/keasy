import { cache } from 'react';
import { cookies } from 'next/headers';

const API_URL = process.env.KEASY_API_URL!;

export const getEffectiveRole = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies();
  try {
    const res = await fetch(`${API_URL}/v1/auth/me`, {
      headers: { Cookie: cookieStore.toString() },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.effective_role ?? null;
  } catch {
    return null;
  }
});
