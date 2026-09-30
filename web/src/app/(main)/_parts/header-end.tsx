"use client";

import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The header's trailing slot: the element a page's own header controls are drawn into. */
export const HeaderEndContext = createContext<HTMLElement | null>(null);

/** Draw `children` at the end of the app header, where the showcase keeps a view's switcher. */
export function HeaderEnd({ children }: { children: ReactNode }) {
  const slot = use(HeaderEndContext);
  return slot ? createPortal(children, slot) : null;
}
