"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { BusinessTimeNote, useBusinessTimeZone } from "@/components/ui/business-time-note";
import { datetimeInputToIso, timeZoneLabel } from "@/lib/dates";
import { formatLocalDateTime, waitUntilInputValue } from "@/lib/flow-engine/wait-until";

type DelayUnit = "seconds" | "minutes" | "hours" | "days";
type DelayMode = "duration" | "until";

interface DelayPanelData {
  duration?: number;
  unit?: DelayUnit;
  /** "Esperar hasta" en la hora del negocio: `AAAA-MM-DDTHH:mm`, sin zona. */
  waitUntilLocal?: string;
  /** Como lo guardaban los nodos viejos: ISO con zona. Al editar la fecha pasa a `waitUntilLocal`. */
  waitUntil?: string;
  [key: string]: unknown;
}

interface DelayPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const unitOptions: Array<{ value: DelayUnit; label: string }> = [
  { value: "seconds", label: "Segundos" },
  { value: "minutes", label: "Minutos" },
  { value: "hours", label: "Horas" },
  { value: "days", label: "Días" },
];

const UNIT_WORDS: Record<DelayUnit, [string, string]> = {
  seconds: ["segundo", "segundos"],
  minutes: ["minuto", "minutos"],
  hours: ["hora", "horas"],
  days: ["día", "días"],
};

const presets: Array<{ label: string; duration: number; unit: DelayUnit }> = [
  { label: "30 s", duration: 30, unit: "seconds" },
  { label: "5 min", duration: 5, unit: "minutes" },
  { label: "1 hora", duration: 1, unit: "hours" },
  { label: "1 día", duration: 1, unit: "days" },
  { label: "3 días", duration: 3, unit: "days" },
  { label: "7 días", duration: 7, unit: "days" },
];

/** Un instante en la zona de quien mira, con la zona dicha: "7 nov 2026, 8:00 (GMT-3)". */
function formatInstant(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = date.toLocaleString("es", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${text} (${timeZoneLabel(timeZone, date)})`;
}

/**
 * El panel de «Esperar». Los cambios conservan el resto de los datos del paso (antes los atajos y el cambio de modo
 * reemplazaban todo y se perdía el nombre). "Esperar hasta" se guarda como hora del negocio, sin zona: el motor la lee
 * con `workspaces.timezone`, no con la del navegador de quien armó el flujo. Es una regla del flujo, por eso el campo
 * habla en la hora del negocio y dice cuál es; quien mira desde otra zona ve además a qué hora le cae a él.
 */
export function DelayPanel({ data: rawData, onChange }: DelayPanelProps) {
  const viewerZone = useViewerTimezone();
  const data = rawData as DelayPanelData;
  const duration = data.duration || 0;
  const unit = data.unit || "minutes";
  const [mode, setMode] = useState<DelayMode>(data.waitUntil || data.waitUntilLocal ? "until" : "duration");
  const businessZone = useBusinessTimeZone();

  const handleModeChange = (newMode: DelayMode) => {
    setMode(newMode);
    if (newMode === "duration") onChange({ ...data, duration: data.duration || 5, unit: data.unit || "minutes", waitUntil: undefined, waitUntilLocal: undefined });
    else onChange({ ...data, waitUntilLocal: data.waitUntilLocal || "" });
  };

  const applyPreset = (preset: { duration: number; unit: DelayUnit }) => {
    setMode("duration");
    onChange({ ...data, duration: preset.duration, unit: preset.unit, waitUntil: undefined, waitUntilLocal: undefined });
  };

  const localValue = waitUntilInputValue(data, businessZone);
  const untilText = localValue ? formatLocalDateTime(localValue) : null;
  // El mismo momento en la zona de quien mira: un nodo viejo ya es un instante; el otro hace falta saber la del negocio.
  const instant = data.waitUntilLocal ? (businessZone ? datetimeInputToIso(data.waitUntilLocal, businessZone) : null) : (data.waitUntil ?? null);
  const viewerText = instant ? formatInstant(instant, viewerZone) : null;
  const [one, many] = UNIT_WORDS[unit];

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Cómo esperar</label>
        <div className="flex rounded-lg border border-border bg-muted p-1">
          {(["duration", "until"] as DelayMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "duration" ? "Un tiempo" : "Hasta una fecha"}
            </button>
          ))}
        </div>
      </div>

      {mode === "duration" ? (
        <>
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Cuánto</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                aria-label="Cantidad"
                value={duration}
                onChange={(e) => onChange({ ...data, duration: Math.max(0, parseInt(e.target.value) || 0), waitUntil: undefined, waitUntilLocal: undefined })}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <select
                aria-label="Unidad"
                value={unit}
                onChange={(e) => onChange({ ...data, unit: e.target.value as DelayUnit, waitUntil: undefined, waitUntilLocal: undefined })}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                {unitOptions.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">Atajos</label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => {
                const isActive = duration === preset.duration && unit === preset.unit;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      isActive ? "bg-purple-500 text-white" : "border border-border bg-card text-muted-foreground hover:border-purple-300 hover:text-purple-600",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="delay-until" className="mb-2 block text-xs font-semibold text-foreground">
            Esperar hasta
          </label>
          <input
            id="delay-until"
            type="datetime-local"
            value={localValue}
            onChange={(e) => onChange({ ...data, waitUntilLocal: e.target.value, waitUntil: undefined })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <BusinessTimeNote className="mt-1.5" instant={instant ? new Date(instant) : null} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Si la fecha ya pasó cuando un contacto llega a este paso, se saltea el paso siguiente y el flujo sigue con el que viene después.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted p-3">
        <p className="text-xs font-medium text-muted-foreground">Resumen</p>
        <p className="mt-1 text-sm text-foreground">
          {mode === "duration"
            ? duration > 0
              ? `Espera ${duration} ${duration === 1 ? one : many} y sigue`
              : "Sin espera: sigue de largo"
            : untilText
              ? `Espera hasta el ${untilText} (hora del negocio)`
              : viewerText
                ? `Espera hasta el ${viewerText}`
                : "Elegí una fecha"}
        </p>
      </div>
    </div>
  );
}
