"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { loadBusinessTimeZone } from "@/lib/actions/flow-capabilities";
import { isValidTimeZone } from "@/lib/timezone";
import { convertedTimeText, convertWallTime, formatInstantIn, sameClock, zoneLabel } from "@/lib/business-time";
import { cn } from "@/lib/utils";

// Una sola consulta por página aunque haya varios avisos a la vista.
let businessZonePromise: Promise<string | null> | null = null;

/**
 * La zona horaria del negocio (`workspaces.timezone`), o null mientras carga o si no se pudo leer. Sin zona cargada en
 * el negocio, el sistema usa UTC, y eso es lo que devuelve.
 */
export function useBusinessTimeZone(): string | null {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    businessZonePromise ??= loadBusinessTimeZone()
      .then((tz) => (tz && isValidTimeZone(tz) ? tz : "UTC"))
      .catch(() => {
        businessZonePromise = null;
        return null;
      });
    businessZonePromise.then((tz) => {
      if (!cancelled) setZone(tz);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return zone;
}

/**
 * El aviso debajo de algo que se programa en la hora del NEGOCIO: en qué zona se programa y, si quien mira vive en
 * otra, a qué hora le cae a él. Recibe horas de pared (`times`, «09:00»; dos = un rango) o un instante (`instant`).
 * `at` es el día de referencia para convertir una hora de pared (el horario de verano depende del día).
 */
export function BusinessTimeNote({
  times,
  instant,
  at,
  dateOnly,
  className,
}: {
  times?: Array<string | null | undefined>;
  instant?: Date | null;
  at?: Date | null;
  /** Lo que se programa es un DÍA, no una hora (contar días desde hoy, por ejemplo). */
  dateOnly?: boolean;
  className?: string;
}) {
  const viewerZone = useViewerTimezone();
  const businessZone = useBusinessTimeZone();
  const ref = instant ?? at ?? new Date();

  if (!businessZone) {
    return (
      <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
        <Clock className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>Se programa en la hora del negocio.</span>
      </p>
    );
  }

  const differs = !sameClock(businessZone, viewerZone, ref);
  let mine: string | null = null;
  if (differs) {
    if (instant) {
      mine = formatInstantIn(instant, viewerZone);
    } else {
      const converted = (times ?? []).filter((t): t is string => !!t).map((t) => convertWallTime(t, businessZone, viewerZone, ref));
      if (converted.length > 0 && converted.every((c) => c !== null)) mine = converted.map((c) => convertedTimeText(c!)).join(" a ");
    }
  }

  return (
    <div className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
      <Clock className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <div>
        <p>
          Se programa en la hora del negocio: <span className="font-medium text-foreground">{zoneLabel(businessZone, ref)}</span>
          {differs ? "." : ", la misma que la tuya."}
        </p>
        {differs && mine && (
          <p>
            En tu zona ({zoneLabel(viewerZone, ref)}): <span className="font-medium text-foreground">{mine}</span>
          </p>
        )}
        {differs && !mine && (
          <p>
            Tu zona es otra ({zoneLabel(viewerZone, ref)}): {dateOnly ? "el día se cuenta en la del negocio." : "la hora se cumple en la del negocio."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Una hora o un rango del negocio en la zona de quien mira, en una línea corta («en tu zona: 13:00 a 22:00»), para
 * listas con varios horarios (uno por día). No dibuja nada si quien mira está en la misma zona o mientras carga.
 */
export function InViewerZone({ times, className }: { times: Array<string | null | undefined>; className?: string }) {
  const viewerZone = useViewerTimezone();
  const businessZone = useBusinessTimeZone();
  if (!businessZone || sameClock(businessZone, viewerZone)) return null;
  const converted = times.filter((t): t is string => !!t).map((t) => convertWallTime(t, businessZone, viewerZone));
  if (converted.length === 0 || converted.some((c) => c === null)) return null;
  return <span className={cn("text-[11px] text-muted-foreground", className)}>en tu zona: {converted.map((c) => convertedTimeText(c!)).join(" a ")}</span>;
}

