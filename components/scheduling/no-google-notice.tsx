import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import {
  BROKEN_GOOGLE_BODY,
  BROKEN_GOOGLE_TITLE,
  CONNECT_GOOGLE_HREF,
  NO_GOOGLE_BODY,
  NO_GOOGLE_TITLE,
  otherPersonNotice,
  type GoogleCalendarState,
} from "@/lib/scheduling/google-notice";

/**
 * Aviso (amarillo, de alerta) para la persona sin Google Calendar conectado. Va en la pantalla de agenda (franja,
 * como el de reconectar), en Mi cuenta y en Disponibilidad (tarjeta). Con Google conectado no pinta nada. Con
 * `personName`, habla de otra persona del equipo y no lleva botón (la conexión es de cada uno).
 */
export function NoGoogleNotice({
  state,
  variant = "banner",
  personName,
}: {
  state: GoogleCalendarState;
  variant?: "banner" | "card";
  personName?: string;
}) {
  if (state === "connected") return null;
  const other = personName ? otherPersonNotice(state, personName) : null;
  const title = other?.title ?? (state === "broken" ? BROKEN_GOOGLE_TITLE : NO_GOOGLE_TITLE);
  const body = other?.body ?? (state === "broken" ? BROKEN_GOOGLE_BODY : NO_GOOGLE_BODY);
  const cta = state === "broken" ? "Reconectar Google Calendar" : "Conectar Google Calendar";
  return (
    <div
      role="status"
      data-testid="no-google-notice"
      className={
        variant === "banner"
          ? "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-yellow-300/70 bg-yellow-50 px-4 py-2 text-sm text-yellow-900 dark:border-yellow-400/30 dark:bg-yellow-400/10 dark:text-yellow-100 md:px-6"
          : "mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-yellow-300/70 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-400/30 dark:bg-yellow-400/10 dark:text-yellow-100"
      }
    >
      <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {/* En el celular el botón baja a su propia línea: el texto no queda en una columna angosta. */}
      <span className="min-w-[14rem] flex-1">
        <strong>{title}.</strong> {body}
      </span>
      {!other && (
        <Link
          href={CONNECT_GOOGLE_HREF}
          className="rounded-lg border border-yellow-400 px-2.5 py-1 text-xs font-medium hover:bg-yellow-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 dark:hover:bg-yellow-400/20"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}
