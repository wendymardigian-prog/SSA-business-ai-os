"use client";

/**
 * La cola de WhatsApp de una automatización (00420), en el panel del disparador: prioridad, caducidad («Si no puede salir
 * en…») y límite por hora. Se guarda en `data.whatsappQueue` del disparador, así respeta borrador y publicación como el
 * resto del grafo. Solo cuenta para los WhatsApp que van por la cola. Con la automatización ya guardada, «Aplicar a los
 * envíos programados».
 */
import { useState } from "react";
import Link from "next/link";
import { applyScheduleToQueued } from "@/lib/actions/send-queue";
import { EXPIRY_LABELS, EXPIRY_OPTIONS, type ExpiryOption } from "@/lib/send-queue/automation/expiry";
import { isInstantTrigger, parseQueueSettings, PRIORITY_HELP, PRIORITY_LABELS } from "@/lib/send-queue/automation/settings";
import type { SendQueuePriority } from "@/lib/types/database";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

export function WhatsappQueueSettings({
  value,
  onChange,
  flowId,
  triggerType,
}: {
  value: unknown;
  onChange: (next: Record<string, unknown>) => void;
  flowId?: string | null;
  triggerType?: string;
}) {
  const settings = parseQueueSettings(value);
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const set = (patch: Record<string, unknown>) => onChange({ ...raw, ...settings, ...patch });
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply() {
    if (!flowId) return;
    if (!window.confirm("¿Aplicar la programación publicada a los envíos programados que todavía no salieron? Los que con la regla nueva ya tendrían que haber salido quedan vencidos y no se mandan.")) return;
    setApplying(true);
    setMessage(null);
    try {
      const res = await applyScheduleToQueued(flowId);
      if (!res.ok) setMessage({ ok: false, text: res.error });
      else
        setMessage({
          ok: true,
          text: res.updated + res.overdue === 0 ? "No había envíos programados que cambiar." : `Listo: ${res.updated} con fecha nueva${res.overdue ? ` y ${res.overdue} vencidos (no se mandan)` : ""}.`,
        });
    } catch {
      setMessage({ ok: false, text: "No se pudo aplicar. Probá de nuevo." });
    } finally {
      setApplying(false);
    }
  }

  return (
    <details className="group rounded-lg border border-border p-3" data-testid="whatsapp-queue-settings">
      <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">
        Cola de WhatsApp
        <span className="block text-xs font-normal text-muted-foreground">
          {isInstantTrigger(triggerType)
            ? "Con este disparador los WhatsApp salen al instante, salvo los pasos que elijas mandar por la cola."
            : "Con este disparador los WhatsApp a contactos van por la cola del número."}{" "}
          Prioridad {PRIORITY_LABELS[settings.priority].toLowerCase()} · {settings.expiry === "none" ? "sin caducidad" : `caduca a ${EXPIRY_LABELS[settings.expiry]}`}
          {settings.perRunLimit ? ` · hasta ${settings.perRunLimit} por hora` : ""}
        </span>
      </summary>
      <div className="mt-3 space-y-4">
        <fieldset>
          <legend className={labelClass}>Prioridad</legend>
          <div className="space-y-1.5">
            {(["urgent", "normal", "bulk"] as SendQueuePriority[]).map((p) => (
              <label key={p} className="flex items-start gap-2 text-sm text-foreground">
                <input type="radio" name="wa-queue-priority" className="mt-1" checked={settings.priority === p} onChange={() => set({ priority: p })} />
                <span>
                  {PRIORITY_LABELS[p]}
                  <span className="block text-xs text-muted-foreground">{PRIORITY_HELP[p]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="wa-queue-expiry" className={labelClass}>
            Si no puede salir en…
          </label>
          <select id="wa-queue-expiry" value={settings.expiry} onChange={(e) => set({ expiry: e.target.value as ExpiryOption })} className={inputClass}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {EXPIRY_LABELS[o]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings.expiry === "none"
              ? "Espera lo que haga falta: sale cuando le toca, dentro del horario de envío del número."
              : "Pasado ese plazo el mensaje se descarta («Caducado») en vez de llegar cuando ya no sirve."}
          </p>
        </div>

        <div>
          <label htmlFor="wa-queue-limit" className={labelClass}>
            Límite por hora de esta automatización
          </label>
          <input
            id="wa-queue-limit"
            type="number"
            min={1}
            placeholder="Sin límite"
            value={settings.perRunLimit ?? ""}
            onChange={(e) => set({ perRunLimit: e.target.value === "" ? null : Number(e.target.value) })}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Si en una misma hora coinciden más envíos de esta automatización por el mismo número, el resto pasa a la hora siguiente. Evita que una etiqueta puesta a
            muchos contactos se coma el cupo del número.
          </p>
        </div>

        {flowId && (
          <div>
            <button
              type="button"
              onClick={apply}
              disabled={applying}
              className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
            >
              {applying ? "Aplicando…" : "Aplicar a los envíos programados"}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">Editar la automatización no cambia lo que ya está programado. Esto aplica la programación publicada.</p>
            {message && (
              <p role={message.ok ? "status" : "alert"} className={`mt-1 text-xs ${message.ok ? "text-green-700 dark:text-green-300" : "text-destructive"}`}>
                {message.text}
              </p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          <Link href="/dashboard/flows/cola" className="underline">
            Ver la cola de mensajes
          </Link>
        </p>
      </div>
    </details>
  );
}
