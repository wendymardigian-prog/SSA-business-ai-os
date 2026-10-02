import Link from "next/link";

/**
 * Lo que la card y el detalle de Google tienen que decir (G4): el mismo
 * cliente OAuth sirve para dos cosas distintas, con dos conexiones separadas
 * (`google` y `google_calendar`) y dos vidas distintas.
 *
 * - YouTube es del workspace: conectado o no, se configura aca.
 * - Calendar es POR PERSONA: un si/no mentiria, asi que se cuenta cuantas
 *   personas lo tienen y se linkea a donde se configura de verdad (Agenda).
 * - Drive no se menciona: no existe ningun scope de Drive en el sistema.
 */
export function GoogleServices({
  youtubeConnected,
  calendarPeople,
}: {
  youtubeConnected: boolean;
  calendarPeople: number;
}) {
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
        <span className="text-xs font-medium">YouTube</span>
        <span
          className={`text-xs ${youtubeConnected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
        >
          {youtubeConnected ? "Conectado" : "Sin conectar"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
        <span className="text-xs font-medium">Google Calendar</span>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {calendarPeople === 0
              ? "Nadie lo conecto"
              : calendarPeople === 1
                ? "1 persona conectada"
                : `${calendarPeople} personas conectadas`}
          </p>
          <Link
            href="/dashboard/agenda/configuracion/calendarios"
            className="text-[11px] underline"
          >
            Configurar en Agenda
          </Link>
        </div>
      </div>
    </div>
  );
}
