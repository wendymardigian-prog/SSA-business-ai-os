"use client";

import { useState, useTransition } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { getChannelSendPolicy, saveChannelSendPolicy } from "@/lib/actions/broadcasts";
import { DEFAULT_WHATSAPP_POLICY, describePolicy, type SendPolicy } from "@/lib/send-queue/pace";
import { BusinessTimeNote } from "@/components/ui/business-time-note";

/**
 * El ritmo de los envíos masivos por este número (00285): el TECHO que ningún
 * broadcast puede pasar. WhatsApp bloquea por número, así que el ritmo es del
 * número y lo comparten todos los broadcasts que salen por él.
 */

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const field = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs";

export function WhatsappSendPace({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<SendPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !policy) {
      start(async () => {
        const res = await getChannelSendPolicy(channelId);
        if (res.ok) setPolicy(res.policy);
        else setError(res.error);
      });
    }
  }

  function save() {
    if (!policy) return;
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveChannelSendPolicy(channelId, policy);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  const set = (patch: Partial<SendPolicy>) => {
    setSaved(false);
    setPolicy((p) => (p ? { ...p, ...patch } : p));
  };

  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium hover:bg-muted">
        <Gauge className="h-3 w-3" aria-hidden />
        Ritmo de envíos masivos
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2 text-[11px]">
          <p className="text-muted-foreground">
            Cuánto espera entre mensaje y mensaje un broadcast por este número, y cuántos puede mandar. Mandar muchos seguidos es lo que hace que WhatsApp
            bloquee un número: ante la duda, más lento.
          </p>
          {!policy && pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Cargando" />
          ) : policy ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Num label="Espera mínima (s)" value={policy.minGapSeconds} onChange={(v) => set({ minGapSeconds: v ?? 0 })} />
                <Num label="Espera máxima (s)" value={policy.maxGapSeconds} onChange={(v) => set({ maxGapSeconds: v ?? 0 })} />
                <Num label="Máx. por minuto" value={policy.perMinute} onChange={(v) => set({ perMinute: v })} />
                <Num label="Máx. por hora" value={policy.perHour} onChange={(v) => set({ perHour: v })} />
                <Num label="Máx. por día" value={policy.perDay} onChange={(v) => set({ perDay: v })} />
                <Num label="Pausar tras fallos seguidos" value={policy.pauseAfterFailures} onChange={(v) => set({ pauseAfterFailures: v ?? 0 })} />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={policy.window.enabled} onChange={(e) => set({ window: { ...policy.window, enabled: e.target.checked } })} />
                Solo en un horario
              </label>
              {policy.window.enabled && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Días">
                    {DAYS.map((d, i) => {
                      const on = policy.window.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => set({ window: { ...policy.window, days: on ? policy.window.days.filter((x) => x !== i) : [...policy.window.days, i].sort() } })}
                          className={on ? "rounded-md bg-primary/15 px-2 py-0.5 font-medium" : "rounded-md border border-border px-2 py-0.5 text-muted-foreground"}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="time" value={policy.window.start} onChange={(e) => set({ window: { ...policy.window, start: e.target.value } })} className={field} aria-label="Desde" />
                    <span>a</span>
                    <input type="time" value={policy.window.end} onChange={(e) => set({ window: { ...policy.window, end: e.target.value } })} className={field} aria-label="Hasta" />
                  </div>
                  <BusinessTimeNote times={[policy.window.start, policy.window.end]} />
                </div>
              )}
              <p className="text-muted-foreground">Queda: {describePolicy(policy)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Guardar
                </button>
                <button type="button" onClick={() => set(DEFAULT_WHATSAPP_POLICY)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
                  Volver a lo recomendado
                </button>
                {saved && <span className="text-muted-foreground">Guardado.</span>}
              </div>
            </>
          ) : null}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ""}
        placeholder="sin tope"
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))}
        className={field}
      />
    </label>
  );
}
