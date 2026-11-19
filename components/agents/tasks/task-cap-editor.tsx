"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTaskCap } from "@/lib/actions/ai-tasks";
import { Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { capStatus } from "@/lib/ai-tasks/limits";
import { formatSpend } from "@/lib/background/screen";
import { CapPill } from "./cap-pill";

/**
 * El tope mensual de gasto de una tarea de IA (00440). Vacío = sin tope. Avisa al pasar el porcentaje de aviso
 * (80 % si el negocio no eligió otro) y frena al llegar. Sin `ai_limits.manage`, se ve y no se edita.
 */
export function TaskCapEditor({
  taskId,
  monthlyCapUsd,
  monthSpendUsd,
  canEdit,
}: {
  taskId: string;
  monthlyCapUsd: number | null;
  monthSpendUsd: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [capText, setCapText] = useState(monthlyCapUsd === null ? "" : String(monthlyCapUsd));
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const status = capStatus(monthlyCapUsd, monthSpendUsd);

  const save = () =>
    start(async () => {
      const res = await saveTaskCap(taskId, capText);
      setMessage(res.ok ? { tone: "success", text: "Guardado." } : { tone: "error", text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <Section
      title="Tope mensual de gasto"
      description="Cuánto puede gastar esta tarea en el mes. Al pasar el porcentaje de aviso (80 % si el negocio no eligió otro) llega un aviso a la campana; al llegar al tope, la tarea deja de llamar al modelo hasta el mes siguiente. Se suma a los topes del negocio: frena el primero que se alcance."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tope mensual (USD)" hint="Vacío: sin tope.">
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              className={inputClass}
              value={capText}
              disabled={!canEdit}
              onChange={(e) => setCapText(e.target.value)}
              placeholder="Sin tope"
            />
          )}
        </Field>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        Gasto del mes: <span className="tabular-nums">{monthSpendUsd === null ? "Sin dato" : formatSpend(monthSpendUsd)}</span>
        <CapPill status={status} />
      </p>
      {canEdit ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Para cambiar el tope hace falta el permiso «Administrar topes y precios de IA».</p>
      )}
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
    </Section>
  );
}
