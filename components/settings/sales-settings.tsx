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
}: {
  enabledMethods: PaymentMethodKey[];
  /** Pagos programados o morosos por método (para el aviso de deshabilitar). */
  scheduledByMethod: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
