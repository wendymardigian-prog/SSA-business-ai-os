"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Clock } from "lucide-react";
import { updateWorkspaceTimezone } from "@/lib/actions/workspace";
import { listTimeZones } from "@/lib/timezone";

/**
 * Zona horaria del negocio (F3). Los dashboards cortan los días ("Hoy", "Esta
 * semana") con esta zona. El guardado valida en el servidor: una zona inválida
 * se rechaza.
 */
export function TimezoneSettings({ timezone }: { timezone: string }) {
  const router = useRouter();
  const [value, setValue] = useState(timezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const zones = listTimeZones();

  function change(next: string) {
    setValue(next);
    setSaved(false);
    start(async () => {
      const result = await updateWorkspaceTimezone(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Zona horaria</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Con esta zona se cortan los días y las semanas en los dashboards.
      </p>
      <div className="mt-3">
        <label htmlFor="timezone-select" className="sr-only">
          Zona horaria del workspace
        </label>
        <select
          id="timezone-select"
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {saved && <p className="mt-2 text-xs text-emerald-600">Guardado.</p>}
      </div>
    </section>
  );
}
