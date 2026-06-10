"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspaceStatusBar, type StatusBarPanelButton } from "./workspace-status-bar";

// ── Types ────────────────────────────────────────────────────────────────

export interface PanelDef {
  id: string;
  icon: LucideIcon;
  label: string;
  content: ReactNode;
}

interface WorkspaceLayoutProps {
  children: ReactNode;
  backHref: string;
  backLabel?: string;
  panels: PanelDef[];
  statusLeft?: ReactNode;
  floatingControls?: ReactNode;
  defaultPanel?: string;
  defaultWidth?: number;
  /** Called when active panel changes (for auto-open on node select) */
  onActivePanelChange?: (id: string | null) => void;
}

// ── Context (for PanelHeader close button) ───────────────────────────────

const WorkspaceCtx = createContext<{ closePanel: () => void }>({ closePanel: () => {} });
export function useWorkspacePanel() { return useContext(WorkspaceCtx); }

// ── PanelHeader ──────────────────────────────────────────────────────────

export function PanelHeader({ title }: { title: string }) {
  const { closePanel } = useWorkspacePanel();
  return (
    <div className="h-8 shrink-0 border-b flex items-center justify-between px-2 bg-card">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <button
        className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        onClick={closePanel}
        aria-label="Close panel"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
}

// ── Persistence ──────────────────────────────────────────────────────────

const STORAGE_KEY = "keasy:workspace";

function loadState(defaultWidth: number, defaultPanel?: string) {
  if (typeof window === "undefined") return { width: defaultWidth, panel: defaultPanel ?? null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { width: defaultWidth, panel: defaultPanel ?? null };
    const p = JSON.parse(raw);
    return {
      width: typeof p.width === "number" ? p.width : defaultWidth,
      panel: typeof p.panel === "string" ? p.panel : (defaultPanel ?? null),
    };
  } catch { return { width: defaultWidth, panel: defaultPanel ?? null }; }
}

function saveState(width: number, panel: string | null) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, panel })); } catch {}
}

// ── Component ────────────────────────────────────────────────────────────

export function WorkspaceLayout({
  children,
  backHref,
  backLabel = "Back",
  panels,
  statusLeft,
  floatingControls,
  defaultPanel = "info",
  defaultWidth = 360,
  onActivePanelChange,
}: WorkspaceLayoutProps) {
  const [init] = useState(() => loadState(defaultWidth, defaultPanel));
  const [activePanel, setActivePanel] = useState<string | null>(init.panel);
  const [dockWidth, setDockWidth] = useState(init.width);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((w: number, p: string | null) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveState(w, p), 500);
  }, []);

  // Panel toggle (Zed logic)
  const togglePanel = useCallback((id: string) => {
    setActivePanel((prev) => {
      const next = prev === id ? null : id;
      save(dockWidth, next);
      onActivePanelChange?.(next);
      return next;
    });
  }, [dockWidth, save, onActivePanelChange]);

  // Expose openPanel for external use (e.g., auto-open Info on node click)
  const openPanel = useCallback((id: string) => {
    setActivePanel(id);
    save(dockWidth, id);
    onActivePanelChange?.(id);
  }, [dockWidth, save, onActivePanelChange]);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    save(dockWidth, null);
    onActivePanelChange?.(null);
  }, [dockWidth, save, onActivePanelChange]);

  // Resize
  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: dockWidth };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const next = Math.max(280, Math.min(600, dragRef.current.startW + (dragRef.current.startX - ev.clientX)));
      setDockWidth(next);
    };
    const onUp = () => {
      if (dragRef.current) save(dockWidth, activePanel);
      dragRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [dockWidth, activePanel, save]);

  const onResizeDoubleClick = useCallback(() => {
    setDockWidth(defaultWidth);
    save(defaultWidth, activePanel);
  }, [defaultWidth, activePanel, save]);

  // Keyboard
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setActivePanel((prev) => {
          const next = prev ? null : (defaultPanel ?? panels[0]?.id ?? null);
          save(dockWidth, next);
          return next;
        });
      }
      if (e.key === "Escape" && activePanel) {
        closePanel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, dockWidth, defaultPanel, panels, save, closePanel]);

  const statusPanels: StatusBarPanelButton[] = panels.map(({ id, icon, label }) => ({ id, icon, label }));
  const activePanelContent = panels.find((p) => p.id === activePanel)?.content ?? null;
  const dockOpen = activePanel != null && activePanelContent != null;

  return (
    <WorkspaceCtx.Provider value={{ closePanel }}>
      <TooltipProvider delayDuration={300}>
        <div className="relative w-full h-full overflow-hidden flex flex-col bg-background">
          {/* Canvas + Dock area */}
          <div className="relative flex-1 min-h-0">
            {/* Canvas */}
            <div className="absolute inset-0 z-0">{children}</div>

            {/* Back button — icon only */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={backHref}
                  className="absolute top-3 left-3 z-30 h-7 w-7 inline-flex items-center justify-center rounded-sm bg-background/80 backdrop-blur-sm border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={backLabel}
                >
                  <ArrowLeft size={14} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{backLabel}</TooltipContent>
            </Tooltip>

            {/* Floating controls — positioned dynamically */}
            {floatingControls && (
              <div
                className="absolute z-30 bottom-3"
                style={{ right: dockOpen ? dockWidth + 12 : 12 }}
              >
                {floatingControls}
              </div>
            )}

            {/* Right dock */}
            {dockOpen && (
              <div
                className="absolute top-0 right-0 bottom-0 z-20 flex"
                style={{ width: dockWidth }}
              >
                <div
                  className="w-1.5 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
                  onPointerDown={onResizeDown}
                  onDoubleClick={onResizeDoubleClick}
                  role="separator"
                  aria-orientation="vertical"
                />
                <div className="flex-1 flex flex-col min-w-0 bg-card border-l overflow-hidden">
                  {activePanelContent}
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <WorkspaceStatusBar
            left={statusLeft}
            panels={statusPanels}
            activePanel={activePanel}
            onPanelToggle={togglePanel}
          />
        </div>
      </TooltipProvider>
    </WorkspaceCtx.Provider>
  );
}
