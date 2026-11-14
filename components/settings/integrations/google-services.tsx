import Link from "next/link";
import type { GoogleServicesSummary } from "./types";

/**
 * Lo que la card de Google dice de cada servicio (G4, 00374). El mismo cliente
 * OAuth sirve para tres cosas, cada una con su conexion y su vida:
 *
 * - YouTube es del negocio y puede tener VARIOS canales: se cuentan.
 * - Calendar es POR PERSONA: un si/no mentiria, asi que se cuenta cuantas
 *   personas lo tienen y se linkea a donde se configura de verdad (Agenda).
 * - Drive es del negocio, una cuenta: conectada o no.
 */
export function GoogleServices({
  google,
  calendarPeople,
}: {
  google: GoogleServicesSummary | undefined;
  calendarPeople: number;
}) {
  const channels = google?.youtube ?? [];
  const brokenChannels = channels.filter((c) => c.status !== "active").length;
  const drive = google?.drive ?? null;

  return (
    <div className="mt-2 space-y-2">
      <Row label="YouTube">
        <span
          className={`truncate text-xs ${
            channels.length === 0
              ? "text-muted-foreground"
              : brokenChannels > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {channels.length === 0
            ? "Sin conectar"
            : channels.length === 1
              ? channels[0].label
              : `${channels.length} canales`}
          {brokenChannels > 0 && ` · ${brokenChannels === 1 ? "1 necesita atención" : `${brokenChannels} necesitan atención`}`}
        </span>
      </Row>
      <Row label="Google Calendar">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {calendarPeople === 0
              ? "Nadie lo conectó"
              : calendarPeople === 1
                ? "1 persona conectada"
                : `${calendarPeople} personas conectadas`}
          </p>
          <Link href="/dashboard/agenda/configuracion/calendarios" className="text-[11px] underline">
            Configurar en Agenda
          </Link>
        </div>
      </Row>
      <Row label="Google Drive">
        <span
          className={`truncate text-xs ${
            !drive
              ? "text-muted-foreground"
              : drive.status !== "active"
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
          }`}
          title={drive?.label}
        >
          {!drive ? "Sin conectar" : drive.status !== "active" ? "Necesita atención" : drive.label}
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <span className="shrink-0 text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}
