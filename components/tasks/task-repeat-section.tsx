"use client";
// @plantilla-quitar(servicios)

/**
 * «Se repite» en el detalle de una tarea que es la vuelta de un paso del camino (00522): qué vuelta es, la regla y el
 * link al servicio, donde se cambia o se termina la serie.
 */
import { useState } from "react";
import Link from "next/link";
import { Repeat } from "lucide-react";
import type { TaskRepeatInfo } from "@/lib/tasks/format";
import { serviceHref } from "@/lib/services/screens/record-url";
import { FixSeriesDialog } from "@/components/services/records/fix-series-dialog";

const civilShort = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short" });

export function TaskRepeatSection({ info }: { info: TaskRepeatInfo }) {
  return (
    <section aria-label="Se repite" className="flex items-start gap-2 border-b border-border px-4 py-3 text-sm">
      <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Se repite · vuelta {info.round}
          {info.roundOn ? ` · del ${civilShort.format(new Date(`${info.roundOn}T12:00:00Z`))}` : ""}
        </p>
        {info.rule && <p className="text-xs text-muted-foreground">{info.rule}</p>}
        <p className="text-xs text-muted-foreground">
          {info.ended ? "La serie ya terminó." : "La próxima vuelta crea su propia tarea."}{" "}
          <Link href={serviceHref(info.serviceId)} scroll={false} className="text-primary-ink hover:underline">
            Ver la serie en el servicio
          </Link>
        </p>
      </div>
    </section>
  );
}

const FIX_REF = /^svc_series_fix:([0-9a-f-]{36})$/i;

/** El paso de la tarea «Fijar reuniones recurrentes con …» (00524), o null. Pura. */
export function seriesFixItemOf(task: { source: string | null; source_ref: string | null }): string | null {
  if (task.source !== "cx" || !task.source_ref) return null;
  return FIX_REF.exec(task.source_ref)?.[1] ?? null;
}

/** El botón de la tarea «Fijar reuniones recurrentes»: abre el cuadro para elegir el primer día y la hora. */
export function TaskSeriesFixButton({ itemId, title, canEdit }: { itemId: string; title: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <section aria-label="Fijar la serie" className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm">
      <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">Elegí el primer día y la hora: se crea un solo evento que se repite en tu Google Calendar.</p>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground md:min-h-8">
        Fijar reuniones
      </button>
      {open && <FixSeriesDialog itemId={itemId} stepName={title} rule="" mode="fix" onClose={() => setOpen(false)} />}
    </section>
  );
}
