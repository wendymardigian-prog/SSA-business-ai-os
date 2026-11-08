// @plantilla-quitar(servicios)
"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Plus, Workflow } from "lucide-react";
import { createPathWorkflow } from "@/lib/actions/services";
import { workflowStatsLabel, type PathSlot, type PathWorkflow } from "@/lib/services/screens/workflow-chips";
import { cn } from "@/lib/utils";

/** La URL a la que vuelve el editor de Automatizaciones («Volver al camino»). */
export function backToPath(): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.searchParams.set("tab", "camino");
  return `${u.pathname}${u.search}`;
}

/**
 * Los workflows de un lugar del camino (F117): cada uno como una línea de chips (disparador → pasos), con sus
 * ejecuciones de 30 días; pausado se ve atenuado. «+ Workflow» crea la automatización con el disparador ya puesto y
 * abre el editor con «Volver al camino». Sin permiso para editar automatizaciones, se ven pero no se crean.
 */
export function WorkflowSlot({
  variantId,
  slot,
  title,
  workflows,
  canEdit,
  compact = false,
}: {
  variantId: string;
  slot: PathSlot;
  title: string;
  workflows: PathWorkflow[];
  canEdit: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function create() {
    start(async () => {
      const res = await createPathWorkflow(variantId, slot, title);
      if (res.ok) router.push(`/dashboard/flows/${res.data}?volver=${encodeURIComponent(backToPath())}`);
    });
  }

  if (compact && workflows.length === 0 && !canEdit) return null;
  return (
    <div className={cn("space-y-1", compact ? "pl-6" : "")}>
      {!compact && <p className="text-xs font-semibold text-foreground">{title}</p>}
      {workflows.map((w) => (
        <Link
          key={w.id}
          href={`/dashboard/flows/${w.id}?volver=${encodeURIComponent(backToPath())}`}
          className={cn(
            "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] hover:bg-accent/40",
            w.status !== "published" && "opacity-60",
          )}
        >
          <Workflow className="h-3 w-3 text-muted-foreground" aria-hidden />
          {w.chips.map((c, i) => (
            <span key={`${c}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">{c}</span>
            </span>
          ))}
          <span className="ml-auto text-muted-foreground">
            {w.status !== "published" ? "Pausado · " : ""}
            {workflowStatsLabel(w)}
          </span>
        </Link>
      ))}
      {canEdit && (
        <button type="button" disabled={pending} onClick={create} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
          Workflow
        </button>
      )}
    </div>
  );
}
