"use client";

import Link from "next/link";
import { CalendarDays, Settings } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ReconnectBanner } from "./reconnect-banner";
import { gmtOffsetLabel, timezoneCityLabel } from "@/lib/scheduling/booker/format";

/**
 * La pantalla de Agendas (F8/F33). En el Bloque 1 tiene la barra completa
 * (⚙ y "+ Agendar"), el aviso de reconectar y el vacio; las vistas llegan en
 * el Bloque 5.
 */
export function AgendaHomeView({
  showConfig,
  needsProfile,
  brokenAccounts,
  viewerTimezone,
  scopeAll,
}: {
  showConfig: boolean;
  needsProfile: boolean;
  brokenAccounts: string[];
  viewerTimezone: string;
  scopeAll: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/agenda"
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Agendar a mano llega en el Bloque 5"
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              + Agendar
            </button>
            {showConfig && (
              <Link
                href="/dashboard/agenda/configuracion"
                aria-label="Configuración de agenda"
                title="Configuración de agenda"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
            )}
          </div>
        }
      />
      <ReconnectBanner accounts={brokenAccounts} />
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground md:px-6">
        <span className="rounded-full border border-border px-2.5 py-0.5">{scopeAll ? "Todas las agendas del equipo" : "Solo tus agendas"}</span>
        <Link href="/dashboard/agenda/configuracion/ajustes" className="rounded-full border border-border px-2.5 py-0.5 hover:bg-muted">
          Hora de {timezoneCityLabel(viewerTimezone)} ({gmtOffsetLabel(new Date(), viewerTimezone)})
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <CalendarDays className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-base font-semibold">Todavía no hay agendas</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {needsProfile
              ? "Para empezar, elegí tu usuario y tu zona horaria en Ajustes. Después conectá tu Google Calendar y creá tu primer evento."
              : "Las agendas aparecen acá cuando alguien reserva una llamada por tu link, tu embed o el agente."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {needsProfile ? (
              <Link href="/dashboard/agenda/configuracion/ajustes" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                Completar mi perfil
              </Link>
            ) : (
              showConfig && (
                <Link href="/dashboard/agenda/configuracion/calendarios" className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                  Conectar Google Calendar
                </Link>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
