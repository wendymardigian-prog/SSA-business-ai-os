"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { systemStatusDetails, SYSTEM_STATUS_LABELS, type SystemStatus } from "@/lib/agent/ai-dashboard/system-status";

export interface SystemStatusCardProps {
  status: SystemStatus;
}

const DOT: Record<SystemStatus["level"], string> = { ok: "🟢", warning: "🟡", critical: "🔴" };
const TONE: Record<SystemStatus["level"], string> = {
  ok: "border-border",
  warning: "border-warn/40",
  critical: "border-bad/40",
};

/**
 * La quinta tarjeta (A5): estado del sistema, con sus tres señales. Se
 * despliega al clic; nunca inventa una señal que el sistema no tiene (no hay
 * latido del worker).
 */
export function SystemStatusCard({ status }: SystemStatusCardProps) {
  const [open, setOpen] = useState(false);
  const details = systemStatusDetails(status);

  return (
    <div className={cn("col-span-2 flex min-w-0 flex-col rounded-[14px] border bg-card p-4 md:col-span-1", TONE[status.level])}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground"
      >
        <span className="truncate">Estado del sistema</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 flex items-center gap-1.5 text-left">
        <span aria-hidden>{DOT[status.level]}</span>
        <span className="text-[20px] font-semibold leading-tight tracking-tight">{SYSTEM_STATUS_LABELS[status.level]}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
          {details.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            <Link href="/dashboard/agents/runs?resultado=error" className="font-medium text-primary underline-offset-2 hover:underline">
              Ver corridas con error
            </Link>
            <Link href="/dashboard/settings/integrations" className="font-medium text-primary underline-offset-2 hover:underline">
              Ver Integraciones
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
