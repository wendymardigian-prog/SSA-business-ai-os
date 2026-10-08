"use client";

import Link from "next/link";
import { CalendarDays, SearchX } from "lucide-react";
import { CopyLinkButton } from "./copy-link-button";
import type { ShareableEvent } from "./share-links-menu";

/**
 * Los dos estados vacíos de Agenda (Agenda v2): no es el mismo problema no
 * tener NINGUNA agenda que no tener ninguna con los filtros puestos, y antes
 * los dos mostraban el mismo cartel ("Conectar Google Calendar") sin mirar si
 * ya había calendario conectado o eventos creados.
 */

/** El workspace no tiene ninguna agenda todavía (sin importar filtros). */
export function AgendaEmptyWorkspace({
  events,
  hasCalendar,
  canManage,
  onBookManually,
}: {
  events: ShareableEvent[];
  hasCalendar: boolean;
  canManage: boolean;
  onBookManually: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border p-10 text-center">
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <CalendarDays className="h-6 w-6" />
      </span>
      <div>
        <h2 className="text-base font-semibold">Todavía no hay agendas</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {events.length > 0
            ? "Compartí el link de uno de tus eventos para recibir la primera, o agendá a mano."
            : "Creá tu primer evento para tener un link que compartir, o agendá a mano."}
        </p>
      </div>

      {events.length > 0 && (
        <ul className="w-full max-w-sm space-y-1.5 text-left">
          {events.slice(0, 5).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.areaLabel ? `${e.areaLabel} · ` : ""}
                  {e.durationMinutes} min
                </p>
              </div>
              <CopyLinkButton url={e.url} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {events.length > 0 ? (
          <Link href="/dashboard/agenda/configuracion/eventos" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Ver todos los eventos
          </Link>
        ) : (
          canManage && (
            <Link href="/dashboard/agenda/configuracion/eventos" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
              Crear tu primer evento
            </Link>
          )
        )}
        {!hasCalendar && (
          <Link href="/dashboard/agenda/configuracion/calendarios" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Conectar Google Calendar
          </Link>
        )}
        {canManage && (
          <button type="button" onClick={onBookManually} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
            + Agendar
          </button>
        )}
      </div>
    </div>
  );
}

/** Hay agendas, pero ninguna entra en el período / la pestaña / los filtros elegidos. */
export function AgendaEmptyFiltered({ onClearFilters, onShowAll }: { onClearFilters: () => void; onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-10 text-center">
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="h-6 w-6" />
      </span>
      <h2 className="text-base font-semibold">No hay agendas con estos filtros</h2>
      <p className="max-w-md text-sm text-muted-foreground">Probá sacar algún filtro o mirar todo el historial, sin límite de fechas.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onClearFilters} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Limpiar filtros
        </button>
        <button type="button" onClick={onShowAll} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Ver todo el historial
        </button>
      </div>
    </div>
  );
}
