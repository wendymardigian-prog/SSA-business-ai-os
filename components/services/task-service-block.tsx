// @plantilla-quitar(servicios)
"use client";

/**
 * Lo de Servicios dentro del panel de una tarea (A4, F153 y F154): la franja del servicio con «Ver ficha», el candado
 * del paso y su evidencia. Se pide al abrir la tarea; sin servicio ni paso no dibuja nada.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { loadTaskServicePanel, type TaskServicePanel } from "@/lib/actions/task-service";
import { EvidenceBox } from "@/components/services/evidence-box";
import { LightDot } from "@/components/services/clients/services-list-view";

export function TaskServiceBlock({ taskId, canEdit, version }: { taskId: string; canEdit: boolean; version: string }) {
  const [panel, setPanel] = useState<TaskServicePanel | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTaskServicePanel(taskId).then((res) => {
      if (alive) setPanel(res.ok ? res.data : null);
    });
    return () => {
      alive = false;
    };
  }, [taskId, version]);
  if (!panel || (!panel.service && !panel.item)) return null;
  return (
    <div className="space-y-3 border-b border-border px-4 py-3">
      {panel.service && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <LightDot light={panel.service.light} label="Semáforo del servicio" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{panel.service.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{panel.service.detail}</span>
          </span>
          <Link href={panel.service.href} className="shrink-0 text-xs text-primary-ink hover:underline">
            Ver ficha
          </Link>
        </div>
      )}
      {panel.item?.lockMessage && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {panel.item.lockMessage}
        </p>
      )}
      {panel.item && (
        <EvidenceBox
          itemId={panel.item.id}
          entries={panel.item.evidence}
          rule={panel.item.rule}
          itemStatus={panel.item.status}
          viewerId={panel.viewerId}
          canAdd={canEdit}
          missing={panel.item.missing}
        />
      )}
    </div>
  );
}
