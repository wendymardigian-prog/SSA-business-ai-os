"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { SaleModal } from "@/components/shared/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { generateCommissionPayout } from "@/lib/actions/commissions";
import type { PayoutResult } from "@/lib/commissions/action-types";
import { payoutResultMessage, type Selection } from "@/lib/commissions/list-view";
import { EXCLUDED_MESSAGES, payoutConcept, planPayout, summarizeSelection, type PayoutMode } from "@/lib/commissions/selection";
import { addDays } from "@/lib/finance/dates";
import { formatUsd } from "@/lib/finance/format";

/**
 * «Generar gasto» (F60). Muestra, antes de escribir nada, qué gastos saldrían de la selección: uno por persona (lo
 * normal) o uno solo, con su total y su concepto editable. Un grupo cuyo total es 0 o negativo no genera gasto y
 * se ve en rojo. El servidor vuelve a excluir lo que no corresponde (ya estaba en otro gasto, quedó anulada…) y acá
 * se cuenta por qué.
 */
export function PayoutDialog({
  selection,
  members,
  today,
  onClose,
  onDone,
}: {
  selection: Selection;
  members: ReadonlyArray<{ id: string; name: string }>;
  today: string;
  onClose: () => void;
  /** Se llamó después de generar los gastos: quien llama limpia la selección y refresca la lista. */
  onDone: () => void;
}) {
  const selected = useMemo(() => [...selection.values()], [selection]);
  const [mode, setMode] = useState<PayoutMode>("per_person");
  const [scheduledDate, setScheduledDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayoutResult | null>(null);
  const [pending, start] = useTransition();

  const minDate = addDays(today, -60);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "Una persona" : "");
  const plan = planPayout(selected, mode);
  const keyOf = (userId: string | null) => (mode === "single" ? "single" : userId ?? "");
  const suggested = (userId: string | null): string => {
    const list = selected.filter((c) => (userId ? c.userId === userId : true));
    return payoutConcept(userId ? nameOf(userId) : null, list);
  };
  const conceptOf = (userId: string | null): string => edited[`${mode}:${keyOf(userId)}`] ?? suggested(userId);
  const payable = plan.filter((g) => g.payable);
  const dateOk = !!scheduledDate && scheduledDate >= minDate;
  const canSubmit = payable.length > 0 && dateOk && !pending;

  function submit() {
    setError(null);
    if (!dateOk) return setError("La fecha programada no puede ser anterior a hace 60 días");
    const concepts: Record<string, string> = {};
    for (const g of payable) {
      const text = conceptOf(g.userId).trim();
      if (text) concepts[keyOf(g.userId)] = text;
    }
    start(async () => {
      const res = await generateCommissionPayout({ ids: selected.map((c) => c.id), mode, scheduledDate, concepts, notes: notes.trim() || null });
      if (!res.ok) return setError(res.error);
      setResult({ expenses: res.expenses, excluded: res.excluded });
    });
  }

  const finish = () => {
    onDone();
    onClose();
  };

  return (
    <SaleModal
      title="Generar gasto"
      label="Generar gasto de comisiones"
      size="lg"
      onClose={result ? finish : onClose}
      footer={
        result ? (
          <div className="ml-auto flex gap-2">
            {result.expenses.length > 0 && (
              <Link href="/dashboard/finanzas/gastos" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">Ver los gastos</Link>
            )}
            <button type="button" onClick={finish} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Listo</button>
          </div>
        ) : (
          <>
            {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={!canSubmit} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {payable.length > 1 ? `Generar ${payable.length} gastos` : "Generar gasto"}
              </button>
            </div>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm" role="status">
          <p className="font-medium">{payoutResultMessage(result.expenses, result.excluded)}</p>
          {result.excluded.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {result.excluded.map((e) => <li key={e.id}>{e.message}</li>)}
            </ul>
          )}
          {result.expenses.length > 0 && <p className="text-xs text-muted-foreground">Quedaron programados en Finanzas. Se pagan desde ahí y, cuando se pagan, estas comisiones pasan a «Pagada».</p>}
        </div>
      ) : (
        <>
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{summarizeSelection(selected)}</p>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Cómo se arman los gastos</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="payout-mode" className="mt-1" checked={mode === "per_person"} onChange={() => setMode("per_person")} />
              <span>Un gasto por persona <span className="text-xs text-muted-foreground">(lo más común: cada una cobra lo suyo)</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="payout-mode" className="mt-1" checked={mode === "single"} onChange={() => setMode("single")} />
              <span>Un solo gasto <span className="text-xs text-muted-foreground">(todo junto, por ejemplo si le pagás a una agencia)</span></span>
            </label>
          </fieldset>

          <DialogField label="Fecha programada" hint="Cuándo vas a pagar. Hoy o hasta 60 días atrás.">
            <input type="date" className={fieldInput} value={scheduledDate} min={minDate} onChange={(e) => setScheduledDate(e.target.value)} aria-invalid={!dateOk} />
          </DialogField>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">Los gastos que se van a generar</caption>
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{mode === "single" ? "Gasto" : "Persona"}</th>
                  <th scope="col" className="px-3 py-2 font-medium">Comisiones</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 font-medium">Concepto del gasto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plan.map((g) => {
                  const id = `concept-${mode}-${keyOf(g.userId)}`;
                  return (
                    <tr key={keyOf(g.userId)} className={g.payable ? "" : "bg-red-500/5"}>
                      <td className="px-3 py-2 font-medium">{mode === "single" ? "Todas juntas" : nameOf(g.userId)}</td>
                      <td className="px-3 py-2 tabular-nums">{g.count}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${g.payable ? "" : "text-red-600 dark:text-red-400"}`}>{formatUsd(g.totalCents)}</td>
                      <td className="px-3 py-2">
                        {g.payable ? (
                          <>
                            <label htmlFor={id} className="sr-only">Concepto del gasto de {mode === "single" ? "todas las comisiones" : nameOf(g.userId)}</label>
                            <input
                              id={id}
                              className={fieldInput}
                              maxLength={200}
                              value={conceptOf(g.userId)}
                              onChange={(e) => setEdited((prev) => ({ ...prev, [`${mode}:${keyOf(g.userId)}`]: e.target.value }))}
                            />
                          </>
                        ) : (
                          <p className="text-xs text-red-600 dark:text-red-400">{EXCLUDED_MESSAGES.non_positive_total}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {payable.length === 0 && <p role="status" className="text-xs text-red-600 dark:text-red-400">Con esta selección no se genera ningún gasto: el total de cada grupo es 0 o negativo.</p>}

          <DialogField label="Notas (opcional)" hint={`${notes.length}/2000`}>
            <textarea className={`${fieldInput} min-h-20`} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Algo que quieras dejar anotado en el gasto" />
          </DialogField>
        </>
      )}
    </SaleModal>
  );
}
