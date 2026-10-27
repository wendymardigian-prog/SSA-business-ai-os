"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { updatePaymentMethods } from "@/lib/actions/sales-settings";
import { SaleModal } from "@/components/shared/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { Switch } from "@/components/ui/switch";
import { feePreviewText } from "@/lib/sales/fee-preview";
import type { PaymentMethodConfig } from "@/lib/sales/payment-methods-config";
import { EMPTY_DRAFT, draftFromMethod, feeSummary, methodsPayload, parseDecimal, parseDraft, togglePayload, type MethodDraft } from "@/lib/sales/payment-methods-form";

/**
 * Los métodos de pago del negocio (Ajustes > General > Ventas): nombre, comisión del procesador y
 * activo. Un método no se borra: se desactiva (los pagos viejos lo siguen mostrando). La lógica vive en
 * `lib/sales/payment-methods-form.ts` y `payment-methods-config.ts`; acá solo se compone.
 */
export function PaymentMethodsCard({
  methods,
  scheduledByMethod,
}: {
  methods: PaymentMethodConfig[];
  /** Pagos programados o morosos por método (para el aviso de desactivar). */
  scheduledByMethod: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<MethodDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const activeCount = methods.filter((m) => m.active).length;
  const warnings = methods.filter((m) => !m.active && (scheduledByMethod[m.key] ?? 0) > 0);

  function toggle(key: string, active: boolean) {
    start(async () => {
      const result = await updatePaymentMethods(togglePayload(methods, key, active));
      if (!result.ok) return setError(result.error);
      setError(null);
      router.refresh();
    });
  }

  function save() {
    if (!draft) return;
    const parsed = parseDraft(draft, methods);
    if (!parsed.ok) return setFormError(parsed.error);
    start(async () => {
      const result = await updatePaymentMethods(methodsPayload(methods, draft, parsed.value));
      if (!result.ok) return setFormError(result.error);
      setDraft(null);
      setFormError(null);
      setError(null);
      router.refresh();
    });
  }

  const preview = draft
    ? (() => {
        const pct = parseDecimal(draft.percent);
        const fixed = parseDecimal(draft.fixed);
        if (pct === null || fixed === null || pct > 100) return null;
        return feePreviewText({ pct, fixed });
      })()
    : null;

  return (
    <fieldset className="mt-4">
      <div className="flex items-center gap-2">
        <legend className="text-xs font-medium text-muted-foreground">Métodos de pago</legend>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setDraft({ ...EMPTY_DRAFT });
          }}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Método de pago
        </button>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <caption className="sr-only">Métodos de pago del negocio y la comisión que se queda cada procesador</caption>
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">Comisión del procesador</th>
              <th scope="col" className="px-3 py-2 font-medium">Activo</th>
              <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.key} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{m.name}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{feeSummary(m)}</td>
                <td className="px-3 py-2">
                  <Switch label={`${m.name}: activo`} size="sm" checked={m.active} disabled={pending || (m.active && activeCount === 1)} onChange={(v) => toggle(m.key, v)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Editar ${m.name}`}
                    onClick={() => {
                      setFormError(null);
                      setDraft(draftFromMethod(m));
                    }}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Es lo que ofrece el selector al cobrar. Cada cobro guarda el porcentaje, el fijo y el total que se quedó el procesador en ese momento: cambiar un valor acá no toca lo ya cobrado. Un método no se borra, se desactiva.
      </p>

      {warnings.length > 0 && (
        <ul role="status" className="mt-3 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((m) => (
            <li key={m.key}>
              {scheduledByMethod[m.key]} {scheduledByMethod[m.key] === 1 ? "pago programado usa" : "pagos programados usan"} {m.name}, que ya no se ofrece.
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {draft && (
        <SaleModal
          title={draft.key ? "Editar método de pago" : "Nuevo método de pago"}
          label={draft.key ? "Editar método de pago" : "Nuevo método de pago"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && <p role="alert" className="mr-auto text-xs text-red-700 dark:text-red-400">{formError}</p>}
              <button type="button" onClick={() => setDraft(null)} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
              <button type="button" disabled={pending} onClick={save} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar
              </button>
            </>
          }
        >
          <DialogField label="Nombre">
            <input className={fieldInput} maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej.: Stripe" />
          </DialogField>
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField label="Porcentaje (%)">
              <input className={fieldInput} inputMode="decimal" value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} placeholder="0" />
            </DialogField>
            <DialogField label="Fijo por cobro (USD)">
              <input className={fieldInput} inputMode="decimal" value={draft.fixed} onChange={(e) => setDraft({ ...draft, fixed: e.target.value })} placeholder="0" />
            </DialogField>
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground" aria-live="polite">
            {preview ?? "Revisá el porcentaje y el fijo para ver la vista previa."}
          </p>
        </SaleModal>
      )}
    </fieldset>
  );
}
