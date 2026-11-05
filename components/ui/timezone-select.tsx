"use client";

import { useMemo, useSyncExternalStore } from "react";
import { listTimeZones, timezoneOptions } from "@/lib/timezone";
import { gmtOffsetLabel } from "@/lib/scheduling/booker/format";

const subscribe = () => () => {};

/**
 * EL selector de zona horaria del sistema. Siempre incluye el valor actual: un
 * `<select>` sin su valor muestra otra zona como si fuera la guardada.
 *
 * El catalogo se arma recien en el navegador: Node y cada navegador traen listas
 * distintas, y dibujarlas en el servidor rompia la hidratacion. Hasta ese momento
 * la unica opcion es la zona actual, que es lo unico que se ve.
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
  disabled,
  className,
  ariaLabel = "Zona horaria",
  title,
  showOffset = true,
}: {
  value: string;
  onChange: (timezone: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  /** Sumar "(GMT-3)" a cada opcion. */
  showOffset?: boolean;
}) {
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);
  const options = useMemo(() => {
    if (!inBrowser) return [{ tz: value, label: value.replace(/_/g, " ") }];
    const now = new Date();
    return timezoneOptions(value, listTimeZones()).map((tz) => ({
      tz,
      label: `${tz.replace(/_/g, " ")}${showOffset ? ` (${gmtOffsetLabel(now, tz)})` : ""}`,
    }));
  }, [inBrowser, value, showOffset]);

  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} title={title} className={className}>
      {options.map(({ tz, label }) => (
        <option key={tz} value={tz}>
          {label}
        </option>
      ))}
    </select>
  );
}
