"use client";
// @plantilla-quitar(servicios)

/**
 * «Se repite» en el detalle de una tarea que es la vuelta de un paso del camino (00522): qué vuelta es, la regla y el
 * link al servicio, donde se cambia o se termina la serie.
 */
import Link from "next/link";
import { Repeat } from "lucide-react";
import type { TaskRepeatInfo } from "@/lib/tasks/format";
import { serviceHref } from "@/lib/services/screens/record-url";

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
