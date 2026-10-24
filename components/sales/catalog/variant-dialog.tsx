"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createVariant, updateVariant } from "@/lib/actions/products";
import { variantTiming } from "@/lib/sales/catalog/products";
import { BILLING_INTERVAL_LABELS, DURATION_LABELS, DURATION_TYPES, EVENT_DURATION_TYPES, BILLING_INTERVALS } from "@/lib/sales/catalog/variants";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";

export interface VariantFormValues {
  id?: string;
  name: string;
  durationType: string;
  durationValue: string;
  /** La fecha fija de un evento (AAAA-MM-DD). */
  eventDate: string;
  billingType: string;
  billingInterval: string;
  priceUsd: string;
}

export const EMPTY_VARIANT_FORM: VariantFormValues = {
  name: "",
  durationType: "lifetime",
  durationValue: "",
  eventDate: "",
  billingType: "one_time",
  billingInterval: "",
  priceUsd: "",
};

/** Lo que arranca el formulario de una variante nueva: un evento no puede durar «de por vida». */
export function emptyVariantForm(productType: string): VariantFormValues {
  return variantTiming(productType) === "event" ? { ...EMPTY_VARIANT_FORM, durationType: "days", durationValue: "1" } : { ...EMPTY_VARIANT_FORM };
}

/**
 * Crear o editar una variante: nombre, duración (y fecha, si es un evento) y facturación, según el tipo
 * del producto: con duración, sin fecha (empieza el día que compra cada cliente); un evento, con su
 * fecha fija; un producto, sin duración. El
 * precio vive en la variante: acá solo se pide al CREAR (para arrancar con ese
 * precio); cambiarlo después es la pestaña "Precio", que deja el cambio en el historial. Sin sección de Whop
 * (Fase 2).
 */
export function VariantDialog({
  productId,
  productType,
  initial,
  onClose,
}: {
  productId: string;
  productType: string;
  initial: VariantFormValues;
  onClose: () => void;
}) {
  const timing = variantTiming(productType);
  const durationTypes = timing === "event" ? EVENT_DURATION_TYPES : DURATION_TYPES;
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
        eventDate: timing === "event" ? form.eventDate : "",
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

      {timing === "event" && (
        <DialogField label="Fecha del evento">
          <input type="date" value={form.eventDate} onChange={(e) => set({ eventDate: e.target.value })} className={fieldInput} />
        </DialogField>
      )}

      {timing !== "none" && (
        <div className="grid grid-cols-2 gap-3">
          <DialogField label="Duración" hint={timing === "duration" ? "Empieza el día que compra cada cliente" : undefined}>
            <select value={form.durationType} onChange={(e) => set({ durationType: e.target.value })} className={fieldInput}>
              {durationTypes.map((t) => (
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
      )}

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
        <DialogField label="Precio en USD (opcional)" hint="Si lo dejás vacío, la variante queda sin precio y no se puede vender hasta que lo cargues.">
          <input value={form.priceUsd} onChange={(e) => set({ priceUsd: e.target.value })} inputMode="decimal" placeholder="1497" className={fieldInput} />
        </DialogField>
      )}
    </ContentDialog>
  );
}
