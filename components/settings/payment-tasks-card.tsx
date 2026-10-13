"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ListTodo, Loader2 } from "lucide-react";
import { setPaymentTasksEnabled } from "@/lib/actions/task-settings";
import type { TaskPaymentState } from "@/lib/tasks/payment-tasks-types";

/**
 * «Crear una tarea cuando un pago vence» (Tareas × CRM, R5). Al prenderlo se crean y se publican dos flujos (uno crea la
 * tarea para el vendedor cuando el pago vence; el otro la cierra cuando se cobra); al apagarlo vuelven a borrador. El estado
 * sale de los flujos, no de un ajuste aparte.
 */
export function PaymentTasksCard({ initial }: { initial: TaskPaymentState }) {
  const [state, setState] = useState<TaskPaymentState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    start(async () => {
      const result = await setPaymentTasksEnabled(next);
      setState(result.state);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current"
          aria-describedby="payment-tasks-help"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            <ListTodo className="h-4 w-4" aria-hidden /> Crear una tarea cuando un pago vence
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Guardando" />}
          </span>
          <span id="payment-tasks-help" className="mt-0.5 block text-[11px] text-muted-foreground">
            Se crea una tarea para el vendedor cuando un pago pasa a vencido y se cierra sola cuando se cobra.
          </span>
        </span>
      </label>

      {state.enabled && state.flows.length > 0 && (
        <ul className="mt-2 space-y-1 pl-7 text-xs">
          {state.flows.map((f) => (
            <li key={f.id}>
              <Link href={`/dashboard/flows/${f.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{f.name}</Link>
              <span className="text-muted-foreground"> · {f.status === "published" ? "publicado" : "borrador"}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 pl-7 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
