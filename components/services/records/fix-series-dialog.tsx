"use client";
// @plantilla-quitar(servicios)

/**
 * «Fijar reuniones recurrentes» y «Cambiar día y hora» (00524): quien atiende elige el primer día y la hora; cada
 * cuánto se repite viene del paso. Se crea UN evento que se repite en su Google Calendar, con Meet e invitación al
 * cliente, y las fechas de las próximas semanas pasan a la Agenda. El día y la hora se escriben en la zona de quien mira.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { changeMeetingSeriesTime, fixMeetingSeries } from "@/lib/actions/meeting-series";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { ActionError } from "@/components/contacts/ui";
import { SidePanel } from "@/components/tasks/overlay";

const input = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm md:h-9";

export function FixSeriesDialog({ itemId, stepName, rule, mode, onClose }: { itemId: string; stepName: string; rule: string; mode: "fix" | "change"; onClose: () => void }) {
  const router = useRouter();
  const timezone = useViewerTimezone();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const title = mode === "fix" ? "Fijar reuniones recurrentes" : "Cambiar día y hora";

  function save() {
    setError(null);
    start(async () => {
      const action = mode === "fix" ? fixMeetingSeries : changeMeetingSeriesTime;
      const r = await action({ itemId, date, time, timezone });
      if (!r.ok) return setError(r.error.message);
      setDone(r.data.booked);
      router.refresh();
    });
  }

  return (
    <SidePanel label={title} header={<h2 className="text-base font-semibold">{title}</h2>} onClose={onClose}>
      <div className="space-y-3 p-4 text-sm">
        <p>
          «{stepName}»{rule ? ` · ${rule}` : ""}
        </p>
        {done !== null ? (
          <>
            <p className="rounded-lg border border-good/40 bg-good/5 px-3 py-2">
              Listo: la serie quedó en tu Google Calendar, con Meet e invitación al cliente.{" "}
              {done > 0 ? `Ya están en la Agenda las próximas ${done} ${done === 1 ? "reunión" : "reuniones"}.` : "Las reuniones aparecen en la Agenda en las próximas horas."}
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="h-10 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9">
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {mode === "fix"
                ? "Elegí el primer día y la hora. Se crea un solo evento que se repite en tu Google Calendar, con Meet e invitación al cliente."
                : "La serie cambia desde la próxima reunión: las que ya pasaron no se tocan. Google le avisa al cliente."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">
                Primer día
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} mt-1 font-normal`} />
              </label>
              <label className="text-xs font-semibold">
                Hora
                <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={`${input} mt-1 font-normal`} />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">En tu hora ({timezone}).</p>
            {error && <ActionError message={error} />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent md:h-9">
                Cancelar
              </button>
              <button type="button" disabled={pending || !date || !time} onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50 md:h-9">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {mode === "fix" ? "Fijar la serie" : "Cambiar"}
              </button>
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}
