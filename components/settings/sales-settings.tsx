"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { updateSalesSettings } from "@/lib/actions/sales-settings";
import { PaymentMethodsCard } from "@/components/settings/payment-methods-card";
import type { PaymentMethodConfig } from "@/lib/sales/payment-methods-config";

/**
 * Ajustes de Ventas (plano §13.4): qué métodos de pago ofrece el selector.
 * Un pago que ya usa un método deshabilitado lo sigue mostrando; el aviso dice
 * cuántos pagos programados quedan con un método que ya no se ofrece.
 */
export function SalesSettings({
  methods,
  scheduledByMethod,
  maxDiscountPercent,
  overdueGraceDays,
  autoCreateFlows,
}: {
  methods: PaymentMethodConfig[];
  /** Pagos programados o morosos por método (para el aviso de deshabilitar). */
  scheduledByMethod: Record<string, number>;
  /** Tope de descuento sin motivo ni alcance «todas las ventas»; null = sin tope. */
  maxDiscountPercent: number | null;
  overdueGraceDays: number;
  autoCreateFlows: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [discount, setDiscount] = useState(maxDiscountPercent === null ? "" : String(maxDiscountPercent));
  const [grace, setGrace] = useState(String(overdueGraceDays));

  function save(patch: Parameters<typeof updateSalesSettings>[0]) {
    start(async () => {
      const result = await updateSalesSettings(patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }


  return (
    <section>
      <div className="flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Ventas</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <PaymentMethodsCard methods={methods} scheduledByMethod={scheduledByMethod} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-xs font-medium text-muted-foreground">Tope de descuento (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            inputMode="decimal"
            value={discount}
            disabled={pending}
            onChange={(e) => setDiscount(e.target.value)}
            onBlur={() => discount !== (maxDiscountPercent === null ? "" : String(maxDiscountPercent)) && save({ maxDiscountPercent: discount === "" ? null : discount })}
            placeholder="Sin tope"
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">Un descuento mayor pide un motivo y que quien carga tenga alcance «todas las ventas». Vacío: sin tope.</span>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-muted-foreground">Días de gracia antes de la mora</span>
          <input
            type="number"
            min={0}
            max={60}
            step={1}
            inputMode="numeric"
            value={grace}
            disabled={pending}
            onChange={(e) => setGrace(e.target.value)}
            onBlur={() => grace !== String(overdueGraceDays) && save({ overdueGraceDays: grace })}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">Un pago pasa a moroso cuando vence hace más de estos días. 0: al día siguiente del vencimiento.</span>
        </label>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
        <input type="checkbox" checked={autoCreateFlows} disabled={pending} onChange={(e) => save({ autoCreateFlows: e.target.checked })} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current" />
        <span>
          <span className="font-medium">Crear flujos de cobranza</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Deja listos, apagados, cuatro flujos: recordatorio 3 días antes, aviso el día del vencimiento, aviso 3 días después y agradecimiento al saldar. Los prendés vos desde Automatizaciones.
          </span>
        </span>
      </label>


      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
