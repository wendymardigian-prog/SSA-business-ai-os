import Link from "next/link";
import { CONNECTION_STATUS_TEXT, type CalendarConnectionStatus } from "@/lib/scheduling/bookable";

/**
 * «Mis conexiones» → Google Calendar (F18). Resume las cuentas de la propia persona y manda a la
 * pantalla de Calendarios, donde se eligen los calendarios y se desconecta. Conectar usa el mismo OAuth
 * personal de siempre (`/api/oauth/google_calendar/start`): nada de eso cambia.
 */
export function MyGoogleCard({
  canUse,
  hasProfile,
  accounts,
}: {
  /** `scheduling.use`: sin agenda propia no hay nada que conectar. */
  canUse: boolean;
  hasProfile: boolean;
  accounts: Array<{ id: string; label: string; status: CalendarConnectionStatus }>;
}) {
  const connectHref = "/api/oauth/google_calendar/start?redirect_to=/dashboard/agenda/configuracion/calendarios";
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Google Calendar</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Para que tus reuniones revisen conflictos y se creen en tu calendario.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/agenda/configuracion/calendarios" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            Administrar calendarios
          </Link>
          {canUse && (
            <a
              href={hasProfile ? connectHref : undefined}
              aria-disabled={!hasProfile}
              title={hasProfile ? undefined : "Primero completá tu perfil en Agenda → Ajustes"}
              className={`rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground ${hasProfile ? "" : "pointer-events-none opacity-50"}`}
            >
              Conectar cuenta de Google
            </a>
          )}
        </div>
      </div>

      {!canUse ? (
        <p className="mt-3 text-xs text-muted-foreground">Tu rol no tiene agenda propia, así que no hay un calendario para conectar.</p>
      ) : accounts.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Todavía no conectaste ninguna cuenta.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-xs">
              <span className="font-medium">{a.label}</span>
              <span className="text-muted-foreground">{CONNECTION_STATUS_TEXT[a.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
