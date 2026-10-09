"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { updateWorkspaceAiLimits } from "@/lib/actions/agents";
import type { WorkspaceSpendSettings } from "@/lib/ai/spend-settings";
import { Field, NumberInput, inputClass } from "@/components/agents/fields";

/**
 * "Topes y avisos": los topes de gasto de TODA la IA del negocio (el agente,
 * el copywriter, la clasificacion...), con lo que hace cada uno al llegar y el
 * aviso previo.
 *
 * Vive en Agentes (la seccion de IA) y no en Ajustes generales. La pestaña
 * Costos de cada agente muestra esta misma tarjeta: es un solo dato con dos
 * pantallas, ambas escriben por `updateWorkspaceAiLimits`.
 *
 * Los avisos llegan a la campana de notificaciones. Cuando haya un centro de
 * ajustes de notificaciones, el aviso tiene que aparecer ahi enlazado a esta
 * tarjeta (ver `lib/ai/spend-alerts.ts`).
 */
export function SpendLimitsCard({
  settings,
  canEdit,
}: {
  settings: WorkspaceSpendSettings;
  /** Solo Owner/Admin guardan topes. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState<number | null>(settings.dailyUsd);
  const [dailyAction, setDailyAction] = useState(settings.dailyAction);
  const [monthly, setMonthly] = useState<number | null>(settings.monthlyUsd);
  const [monthlyAction, setMonthlyAction] = useState(settings.monthlyAction);
  const [alertPct, setAlertPct] = useState<number | null>(settings.alertPct);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    daily !== settings.dailyUsd ||
    monthly !== settings.monthlyUsd ||
    dailyAction !== settings.dailyAction ||
    monthlyAction !== settings.monthlyAction ||
    alertPct !== settings.alertPct;

  const alertWithoutLimit = alertPct !== null && daily === null && monthly === null;

  function touch<T>(set: (value: T) => void) {
    return (value: T) => {
      setMessage(null);
      set(value);
    };
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await updateWorkspaceAiLimits({
        dailyUsd: daily,
        monthlyUsd: monthly,
        dailyAction,
        monthlyAction,
        alertPct,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "success", text: "Topes y avisos guardados." });
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="spend-limits-title">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 id="spend-limits-title" className="text-sm font-semibold">
          Topes y avisos
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Un tope es lo máximo que se gasta en IA (todo: el agente, el copywriter y lo demás). Se evalúa antes de cada
        llamada al modelo, en la zona del negocio, y los montos son estimados según los precios cargados. Vacío: sin tope.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Field label="Tope diario (USD)">
            {(id) => <NumberInput id={id} value={daily} min={0} step={0.5} allowEmpty onChange={touch(setDaily)} />}
          </Field>
          <Field label="Al llegar al tope diario">
            {(id) => (
              <select
                id={id}
                value={dailyAction}
                disabled={!canEdit}
                onChange={(e) => touch(setDailyAction)(e.target.value as "notify" | "disable")}
                className={inputClass}
              >
                <option value="disable">Frenar la IA hasta mañana</option>
                <option value="notify">Solo avisarme</option>
              </select>
            )}
          </Field>
        </div>

        <div className="space-y-2">
          <Field label="Tope mensual (USD)">
            {(id) => <NumberInput id={id} value={monthly} min={0} step={1} allowEmpty onChange={touch(setMonthly)} />}
          </Field>
          <Field label="Al llegar al tope mensual">
            {(id) => (
              <select
                id={id}
                value={monthlyAction}
                disabled={!canEdit}
                onChange={(e) => touch(setMonthlyAction)(e.target.value as "notify" | "disable")}
                className={inputClass}
              >
                <option value="disable">Apagar el agente</option>
                <option value="notify">Solo avisarme</option>
              </select>
            )}
          </Field>
        </div>
      </div>

      <div className="mt-4 max-w-xs">
        <Field
          label="Avisarme antes, al llegar al (%)"
          hint={
            alertWithoutLimit ? (
              <span className="text-amber-700 dark:text-amber-300">Cargá al menos un tope para que el aviso tenga contra qué medir.</span>
            ) : (
              "De cualquiera de los dos topes. Llega a la campana de notificaciones, una vez por día o por mes. Vacío: sin aviso previo."
            )
          }
        >
          {(id) => (
            <NumberInput id={id} value={alertPct} min={1} max={99} step={1} allowEmpty placeholder="Ej: 80" onChange={touch(setAlertPct)} />
          )}
        </Field>
      </div>

      {canEdit ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={save}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Guardar topes y avisos
          </button>
          {message && (
            <span
              role={message.tone === "error" ? "alert" : "status"}
              className={message.tone === "error" ? "text-xs text-red-700 dark:text-red-400" : "text-xs text-emerald-700 dark:text-emerald-400"}
            >
              {message.text}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">Solo Owner y Admin pueden cambiar los topes.</p>
      )}
    </section>
  );
}
