"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setVariantPrice } from "@/lib/actions/products";
import { formatAmount, formatMoney } from "@/lib/sales/format";
import { ActionError } from "@/components/contacts/ui";
import { Historial } from "@/components/historial/historial";
import { fieldInput } from "@/components/content/dialog";

/**
 * La pestaña "Precio" de una variante: el precio vigente y un campo para cambiarlo. El cambio
 * es inmediato y queda en el historial general (lo escribe la base): abajo se ve cada cambio
 * con el precio de antes y el de ahora. Lo ya vendido conserva el precio con el que se vendió.
 */
export function VariantPriceTab({
  variantId,
  price,
  userNames,
  timeZone,
}: {
  variantId: string;
  /** El precio de la variante; 0 = sin precio. */
  price: number;
  userNames: Record<string, string>;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(price > 0 ? formatAmount(price) : "");

  const dirty = value.trim() !== "" && value.trim() !== (price > 0 ? formatAmount(price) : "");

  function save() {
    setError(null);
    start(async () => {
      const result = await setVariantPrice({ variantId, priceUsd: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {error && <ActionError message={error} />}

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Precio vigente</p>
        {price > 0 ? (
          <p className="mt-1 text-lg font-semibold">{formatMoney(price)}</p>
        ) : (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Esta variante no tiene precio: no se puede vender hasta que lo cargues.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Precio en USD</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="1497" className={`${fieldInput} w-40`} />
        </label>
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar precio
        </button>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Cambios de precio</h4>
        <Historial entityType="product_variant" entityId={variantId} names={{ users: userNames }} timeZone={timeZone} pageSize={10} />
      </div>
    </div>
  );
}
