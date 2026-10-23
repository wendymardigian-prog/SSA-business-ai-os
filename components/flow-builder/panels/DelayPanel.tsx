"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type DelayUnit = "seconds" | "minutes" | "hours" | "days";
type DelayMode = "duration" | "until";

interface DelayPanelData {
  duration?: number;
  unit?: DelayUnit;
  /** "Esperar hasta": ISO con zona (se guarda desde la hora local de quien edita). */
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

/** ISO -> valor de un `datetime-local` en la hora de quien mira. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * El panel de «Esperar». Los cambios conservan el resto de los datos del paso (antes los atajos y el cambio de modo
 * reemplazaban todo y se perdía el nombre). "Esperar hasta" se guarda como ISO con zona: antes quedaba la hora local
 * sin zona y el servidor no sabía de qué hora se trataba (y además el motor lo ignoraba).
 */
export function DelayPanel({ data: rawData, onChange }: DelayPanelProps) {
  const data = rawData as DelayPanelData;
  const duration = data.duration || 0;
  const unit = data.unit || "minutes";
  const [mode, setMode] = useState<DelayMode>(data.waitUntil ? "until" : "duration");

  const handleModeChange = (newMode: DelayMode) => {
    setMode(newMode);
    if (newMode === "duration") onChange({ ...data, duration: data.duration || 5, unit: data.unit || "minutes", waitUntil: undefined });
    else onChange({ ...data, waitUntil: data.waitUntil || "" });
  };

  const applyPreset = (preset: { duration: number; unit: DelayUnit }) => {
    setMode("duration");
    onChange({ ...data, duration: preset.duration, unit: preset.unit, waitUntil: undefined });
  };

  const until = data.waitUntil ? new Date(data.waitUntil) : null;
  const untilValid = until && !Number.isNaN(until.getTime());
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
                onChange={(e) => onChange({ ...data, duration: Math.max(0, parseInt(e.target.value) || 0), waitUntil: undefined })}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <select
                aria-label="Unidad"
                value={unit}
                onChange={(e) => onChange({ ...data, unit: e.target.value as DelayUnit, waitUntil: undefined })}
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
            value={toLocalInput(data.waitUntil)}
            onChange={(e) => {
              const local = e.target.value;
              const iso = local ? new Date(local).toISOString() : "";
              onChange({ ...data, waitUntil: iso });
            }}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            En tu hora local. Si la fecha ya pasó cuando un contacto llega a este paso, sigue sin esperar.
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
            : untilValid
              ? `Espera hasta el ${until!.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`
              : "Elegí una fecha"}
        </p>
      </div>
    </div>
  );
}
