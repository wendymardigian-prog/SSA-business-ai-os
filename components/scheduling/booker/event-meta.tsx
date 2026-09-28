"use client";

/**
 * La columna izquierda del booker (F25): con quien es, que es, cuanto dura,
 * donde y en que zona. Se puede ocultar desde el embed
 * (`hideEventTypeDetails`).
 */

import { Clock, MapPin, Video } from "lucide-react";
import type { BookerEvent } from "./types";
import { TimezoneSelect } from "./timezone-select";

export function EventMeta({
  event,
  timezone,
  onTimezoneChange,
  compact,
}: {
  event: BookerEvent;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
  compact?: boolean;
}) {
  const initials = event.hostName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex flex-col gap-2.5 border-b border-border p-5 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2">
        {event.hostAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.hostAvatarUrl} alt={event.hostName} className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-white"
            style={{ background: event.color ?? "oklch(0.511 0.217 275)" }}
          >
            {initials}
          </span>
        )}
        <span className="text-sm text-muted-foreground">{event.hostName}</span>
      </div>

      {!compact && <h1 className="text-xl font-semibold tracking-tight">{event.title}</h1>}

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        {event.durationMinutes} min
      </p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {event.locationType === "google_meet" ? <Video className="h-4 w-4 shrink-0" aria-hidden /> : <MapPin className="h-4 w-4 shrink-0" aria-hidden />}
        {event.locationType === "google_meet" ? "Google Meet (se crea con la invitación)" : event.locationText || "A confirmar"}
      </p>

      <TimezoneSelect value={timezone} onChange={onTimezoneChange} />

      {!compact && event.description && (
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{event.description}</p>
      )}
      {!compact && event.hostWelcome && (
        <p className="mt-1 rounded-lg bg-muted p-3 text-sm leading-relaxed">{event.hostWelcome}</p>
      )}
    </div>
  );
}
