"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createVariant, updateVariant } from "@/lib/actions/products";
import { BILLING_INTERVAL_LABELS, DURATION_LABELS, DURATION_TYPES, GUARANTEE_TYPES, BILLING_INTERVALS } from "@/lib/sales/catalog/variants";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";

export interface VariantFormValues {
  id?: string;
  name: string;
  durationType: string;
  durationValue: string;
  guaranteeType: string;
  guaranteeValue: string;
  billingType: string;
  billingInterval: string;
  priceUsd: string;
}

export const EMPTY_VARIANT_FORM: VariantFormValues = {
  name: "",
  durationType: "lifetime",
  durationValue: "",
  guaranteeType: "",
  guaranteeValue: "",
  billingType: "one_time",
  billingInterval: "",
  priceUsd: "",
};

/**
 * Crear o editar una variante: nombre, duración, garantía y facturación. El
 * precio vive en la versión, así que acá solo se pide al CREAR (para arrancar
 * con un borrador con ese precio); editar no lo toca. Sin sección de Whop
 * (Fase 2).
 */
export function VariantDialog({
  productId,
  initial,
  onClose,
}: {
  productId: string;
  initial: VariantFormValues;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = !!initial.id;
  const set = (patch: Partial<VariantFormValues>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    setError(null);
    start(async () => {
      const common = {
        name: form.name,
        durationType: form.durationType,
        durationValue: form.durationType === "lifetime" ? "" : form.durationValue,
        guaranteeType: form.guaranteeType,
        guaranteeValue: form.guaranteeType ? form.guaranteeValue : "",
        billingType: form.billingType,
        billingInterval: form.billingType === "recurring" ? form.billingInterval : "",
      };
      const result = editing
        ? await updateVariant({ id: initial.id!, ...common })
        : await createVariant({ productId, ...common, priceUsd: form.priceUsd || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      title={editing ? "Editar variante" : "Nueva variante"}
      label={editing ? "Editar variante" : "Nueva variante"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !form.name.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editing ? "Guardar" : "Crear variante"}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          {error && (
            <p role="alert" className="w-full text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </>
      }
    >
      <DialogField label="Nombre">
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="Estándar" className={fieldInput} />
      </DialogField>

      <div className="grid grid-cols-2 gap-3">
        <DialogField label="Duración">
          <select value={form.durationType} onChange={(e) => set({ durationType: e.target.value })} className={fieldInput}>
            {DURATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "lifetime" ? "De por vida" : DURATION_LABELS[t][1]}
              </option>
            ))}
          </select>
        </DialogField>
        {form.durationType !== "lifetime" && (
          <DialogField label="Cuánto">
            <input value={form.durationValue} onChange={(e) => set({ durationValue: e.target.value })} inputMode="numeric" placeholder="6" className={fieldInput} />
          </DialogField>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DialogField label="Garantía (opcional)">
          <select value={form.guaranteeType} onChange={(e) => set({ guaranteeType: e.target.value })} className={fieldInput}>
            <option value="">Sin garantía</option>
            {GUARANTEE_TYPES.map((t) => (
              <option key={t} value={t}>
                {DURATION_LABELS[t][1]}
              </option>
            ))}
          </select>
        </DialogField>
        {form.guaranteeType && (
          <DialogField label="Cuánto">
            <input value={form.guaranteeValue} onChange={(e) => set({ guaranteeValue: e.target.value })} inputMode="numeric" placeholder="30" className={fieldInput} />
          </DialogField>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DialogField label="Cobro">
          <select value={form.billingType} onChange={(e) => set({ billingType: e.target.value })} className={fieldInput}>
            <option value="one_time">Una sola vez</option>
            <option value="recurring">Recurrente</option>
          </select>
        </DialogField>
        {form.billingType === "recurring" && (
          <DialogField label="Cada">
            <select value={form.billingInterval} onChange={(e) => set({ billingInterval: e.target.value })} className={fieldInput}>
              <option value="">Elegí…</option>
              {BILLING_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {BILLING_INTERVAL_LABELS[i]}
                </option>
              ))}
            </select>
          </DialogField>
        )}
      </div>

      {!editing && (
        <DialogField label="Precio en USD (opcional)" hint="Queda como borrador de la versión 1: lo publicás cuando esté listo.">
          <input value={form.priceUsd} onChange={(e) => set({ priceUsd: e.target.value })} inputMode="decimal" placeholder="1497" className={fieldInput} />
        </DialogField>
      )}
    </ContentDialog>
  );
}
