"use client";

import { minutesToWallTime, wallTimeToMinutes } from "@/lib/scheduling/time/tz";

/** Selector de hora cada 15 minutos (F11). "24:00" solo como fin. */
export function timeOptions(allowEndOfDay: boolean): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) out.push(minutesToWallTime(m));
  if (allowEndOfDay) out.push("24:00");
  return out;
}

export function TimeSelect({
  value,
  onChange,
  label,
  isEnd = false,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  isEnd?: boolean;
  disabled?: boolean;
}) {
  const options = timeOptions(isEnd);
  // Un valor fuera de la grilla (p. ej. 09:05 cargado a mano) se muestra igual.
  const list = options.includes(value) ? options : [...options, value].sort((a, b) => wallTimeToMinutes(a) - wallTimeToMinutes(b));
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-input bg-background px-2 text-sm tabular-nums disabled:opacity-50"
    >
      {list.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
