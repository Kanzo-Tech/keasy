"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
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

// ── Persistence (panel only — width handled by ResizablePanel autoSaveId) ─

const STORAGE_KEY = "keasy:workspace:panel";

function loadPanel(defaultPanel?: string): string | null {
  if (typeof window === "undefined") return defaultPanel ?? null;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? (defaultPanel ?? null);
  } catch { return defaultPanel ?? null; }
}

function savePanel(panel: string | null) {
  try {
    if (panel) localStorage.setItem(STORAGE_KEY, panel);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
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
  onActivePanelChange,
}: WorkspaceLayoutProps) {
  const [activePanel, setActivePanel] = useState<string | null>(() => loadPanel(defaultPanel));

  const togglePanel = useCallback((id: string) => {
    setActivePanel((prev) => {
      const next = prev === id ? null : id;
      savePanel(next);
      onActivePanelChange?.(next);
      return next;
    });
  }, [onActivePanelChange]);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    savePanel(null);
    onActivePanelChange?.(null);
  }, [onActivePanelChange]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setActivePanel((prev) => {
          const next = prev ? null : (defaultPanel ?? panels[0]?.id ?? null);
          savePanel(next);
          return next;
        });
      }
      if (e.key === "Escape" && activePanel) closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel, defaultPanel, panels, closePanel]);

  const statusPanels = useMemo<StatusBarPanelButton[]>(
    () => panels.map(({ id, icon, label }) => ({ id, icon, label })),
    [panels],
  );
  const activePanelContent = panels.find((p) => p.id === activePanel)?.content ?? null;
  const dockOpen = activePanel != null && activePanelContent != null;

  return (
    <WorkspaceCtx.Provider value={{ closePanel }}>
      <TooltipProvider delayDuration={300}>
        <div className="relative w-full h-full overflow-hidden flex flex-col bg-background">
          {/* Canvas + Dock area */}
          <div className="flex-1 min-h-0">
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel>
                <div className="relative w-full h-full">
                  {children}

                  {/* Back button */}
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

                  {/* Floating controls */}
                  {floatingControls && (
                    <div className="absolute z-30 bottom-3 right-3">
                      {floatingControls}
                    </div>
                  )}
                </div>
              </ResizablePanel>

              {dockOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    defaultSize={360}
                    collapsible
                    onResize={(size) => { if (size.inPixels === 0) closePanel(); }}
                  >
                    <div className="flex flex-col h-full bg-card overflow-hidden">
                      {activePanelContent}
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
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
