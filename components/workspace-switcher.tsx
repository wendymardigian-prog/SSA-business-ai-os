"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchWorkspace } from "@/lib/actions/workspace";
import { BrandMark } from "@/components/brand-mark";

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: { id: string; name: string };
  workspaces: WorkspaceItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === current.id) {
      setOpen(false);
      return;
    }
    setSwitching(workspaceId);
    await switchWorkspace(workspaceId);
    router.refresh();
    setOpen(false);
    setSwitching(null);
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent transition-colors"
      >
        <BrandMark size={28} className="rounded-md" />
        <span className="flex-1 truncate text-sm font-semibold text-sidebar-foreground">
          {current.name}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-sidebar-foreground/50 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {/* Workspace list */}
          {workspaces.map((ws) => {
            const isActive = ws.id === current.id;
            const isLoading = switching === ws.id;
            return (
              <button
                key={ws.id}
                onClick={() => handleSwitch(ws.id)}
                disabled={!!switching}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent"
                )}
              >
                <BrandMark size={24} className="rounded" />
                <span className="flex-1 truncate text-left">{ws.name}</span>
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isActive ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
              </button>
            );
          })}

          {/* No hay "crear workspace": un negocio nuevo es una copia nueva del
              sistema (scripts/create-owner.mjs), no otro workspace aca. */}
        </div>
      )}
    </div>
  );
}
