"use client";

import { useState, useTransition } from "react";
import { Coins } from "lucide-react";
import { updateWorkspaceAiLimits } from "@/lib/actions/agents";
import { Field, NumberInput } from "@/components/agents/fields";

/**
 * Topes globales de gasto de IA del workspace (S2).
 *
 * Hoy solo se editan desde Agentes → (un agente) → Costos, un lugar raro
 * para un ajuste del negocio. Reusa `updateWorkspaceAiLimits`
 * (lib/actions/agents.ts), que ya existe: no se escribe una acción nueva.
 * El patrón de UI es el mismo que `LimitsSection` en
 * components/agents/costs-tab.tsx.
 */
export function AiLimitsSettings({
  dailyUsd,
  monthlyUsd,
}: {
  dailyUsd: number | null;
  monthlyUsd: number | null;
}) {
  const [daily, setDaily] = useState<number | null>(dailyUsd);
  const [monthly, setMonthly] = useState<number | null>(monthlyUsd);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(
    null,
  );
  const dirty = daily !== dailyUsd || monthly !== monthlyUsd;

  function handleSave() {
    setMessage(null);
    start(async () => {
      const result = await updateWorkspaceAiLimits({ dailyUsd: daily, monthlyUsd: monthly });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "success", text: "Topes guardados." });
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Topes de gasto</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Se evalúan antes de cada llamada al modelo, con los precios cargados en Agentes.
        El diario avisa; el mensual apaga el agente. Vacío: sin tope global.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Diario (USD)">
          {(id) => (
            <NumberInput
              id={id}
              value={daily}
              min={0}
              step={0.5}
              allowEmpty
              onChange={(v) => {
                setMessage(null);
                setDaily(v);
              }}
            />
          )}
        </Field>
        <Field label="Mensual (USD)">
          {(id) => (
            <NumberInput
              id={id}
              value={monthly}
              min={0}
              step={1}
              allowEmpty
              onChange={(v) => {
                setMessage(null);
                setMonthly(v);
              }}
            />
          )}
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Guardar topes
        </button>
        {message && (
          <span
            role={message.tone === "error" ? "alert" : "status"}
            className={
              message.tone === "error"
                ? "text-xs text-red-700 dark:text-red-400"
                : "text-xs text-emerald-700 dark:text-emerald-400"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
