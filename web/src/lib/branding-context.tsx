"use client";

import { createContext, useContext } from "react";
import type { Branding } from "./branding";

const BrandingContext = createContext<Branding | null>(null);

export const BrandingProvider = BrandingContext.Provider;

/** The instance's look, read once by the root layout. */
export function useBranding(): Branding {
  const branding = useContext(BrandingContext);
  if (!branding) throw new Error("useBranding outside <Providers>");
  return branding;
}
