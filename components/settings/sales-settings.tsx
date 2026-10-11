"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateSalesSettings } from "@/lib/actions/sales-settings";
import { PAYMENT_METHODS, type PaymentMethodKey } from "@/lib/sales/payment-methods";

/**
 * Ajustes de Ventas (plano §13.4): qué métodos de pago ofrece el selector.
 * Un pago que ya usa un método deshabilitado lo sigue mostrando; el aviso dice
 * cuántos pagos programados quedan con un método que ya no se ofrece.
 */
export function SalesSettings({
  enabledMethods,
  scheduledByMethod,
  maxDiscountPercent,
  overdueGraceDays,
  autoCreateFlows,
}: {
  enabledMethods: PaymentMethodKey[];
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

  function toggle(key: PaymentMethodKey, on: boolean) {
    const next = on ? [...enabledMethods, key] : enabledMethods.filter((k) => k !== key);
    start(async () => {
      const result = await updateSalesSettings({ enabledPaymentMethods: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const warnings = PAYMENT_METHODS.filter((m) => !enabledMethods.includes(m.key) && (scheduledByMethod[m.key] ?? 0) > 0);

  return (
    <section>
      <div className="flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Ventas</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-muted-foreground">Métodos de pago que se ofrecen</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PAYMENT_METHODS.map((method) => {
            const checked = enabledMethods.includes(method.key);
            return (
              <label
                key={method.key}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors",
                  pending ? "cursor-not-allowed opacity-60" : "hover:bg-accent/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending || (checked && enabledMethods.length === 1)}
                  onChange={(e) => toggle(method.key, e.target.checked)}
                  className="h-4 w-4 flex-shrink-0 accent-current"
                />
                <span className="font-medium">{method.name}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Es lo que ofrece el selector al cobrar. Un pago que ya usa un método que apagaste lo sigue mostrando.
        </p>
      </fieldset>

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
    </section>
  );
}
