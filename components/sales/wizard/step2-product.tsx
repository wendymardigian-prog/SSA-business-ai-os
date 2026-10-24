"use client";

import Link from "next/link";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { formatMoney } from "@/lib/sales/format";
import { checkDiscount } from "@/lib/sales/sale-math";
import { serviceStartHint } from "@/lib/sales/wizard/service-start";
import type { WizardProduct, WizardVariant } from "@/lib/sales/wizard/catalog";
import type { WizardConfig } from "./types";

export interface Step2Values {
  productId: string;
  variantId: string;
  discountType: "amount" | "percent";
  discountValue: string;
  discountReason: string;
  serviceStartsAt: string;
}

export function selectedVariant(catalog: readonly WizardProduct[], values: Step2Values): { product: WizardProduct | null; variant: WizardVariant | null } {
  const product = catalog.find((p) => p.id === values.productId) ?? null;
  const variant = product?.variants.find((v) => v.id === values.variantId) ?? null;
  return { product, variant };
}

/** Descuento validado con las mismas reglas del servidor (tope, motivo, alcance). */
export function discountState(config: Pick<WizardConfig, "maxDiscountPercent" | "hasAllScope">, base: number, values: Step2Values) {
  const raw = Number(values.discountValue);
  const discount = values.discountValue.trim() === "" || !(raw > 0) ? null : { type: values.discountType, value: raw };
  return checkDiscount(base, discount, { maxPercent: config.maxDiscountPercent, reason: values.discountReason, hasAllScope: config.hasAllScope });
}

/** Paso 2: producto → variante (con el precio vigente a la vista) y descuento. */
export function Step2Product({
  config,
  values,
  onChange,
  onVariant,
}: {
  config: WizardConfig;
  values: Step2Values;
  onChange: (patch: Partial<Step2Values>) => void;
  onVariant: (variant: WizardVariant | null) => void;
}) {
  const { product, variant } = selectedVariant(config.catalog, values);
  const base = variant?.price ?? 0;
  const discount = variant ? discountState(config, base, values) : null;

  if (config.catalog.length === 0) {
    return (
      <div className="rounded-lg border border-border p-6 text-center text-sm">
        <p className="font-medium">Todavía no hay productos para vender</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {config.canManageCatalog ? (
            <>Creá tu primer producto y publicale un precio en <Link className="font-medium text-primary underline-offset-2 hover:underline" href="/dashboard/settings/productos">Ajustes › Productos</Link>.</>
          ) : (
            "Pedile a un admin que cargue un producto con su precio."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <DialogField label="Producto">
          <select
            className={fieldInput}
            value={values.productId}
            onChange={(e) => {
              onChange({ productId: e.target.value, variantId: "" });
              onVariant(null);
            }}
          >
            <option value="">Elegí un producto</option>
            {config.catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </DialogField>
        <DialogField label="Variante">
          <select
            className={fieldInput}
            value={values.variantId}
            disabled={!product}
            onChange={(e) => {
              const next = product?.variants.find((v) => v.id === e.target.value) ?? null;
              onChange({ variantId: e.target.value, discountValue: "", discountReason: "" });
              onVariant(next);
            }}
          >
            <option value="">Elegí una variante</option>
            {product?.variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!!v.unavailable}>
                {v.name}{v.price != null ? ` — ${formatMoney(v.price)}` : " — sin precio vigente"}
              </option>
            ))}
          </select>
        </DialogField>
      </div>
      {product?.variants.some((v) => v.unavailable) && (
        <p className="text-xs text-muted-foreground">
          Hay variantes que no se ofrecen porque no tienen un precio vigente.{config.canManageCatalog && <> Publicá una versión en <Link className="text-primary underline-offset-2 hover:underline" href={`/dashboard/settings/productos/${product.id}`}>el producto</Link>.</>}
        </p>
      )}
      {variant && <p className="text-xs text-muted-foreground">{variant.detail}</p>}

      {variant && (
        <>
          <section aria-label="Descuento" className="grid gap-3 sm:grid-cols-3">
            <DialogField label="Descuento">
              <div className="flex gap-1">
                <select aria-label="Tipo de descuento" className={`${fieldInput} w-24`} value={values.discountType} onChange={(e) => onChange({ discountType: e.target.value as "amount" | "percent" })}>
                  <option value="amount">$</option>
                  <option value="percent">%</option>
                </select>
                <input type="number" min={0} step="0.01" inputMode="decimal" className={fieldInput} value={values.discountValue} onChange={(e) => onChange({ discountValue: e.target.value })} aria-label="Valor del descuento" />
              </div>
            </DialogField>
            <div className="sm:col-span-2">
              <DialogField label="Motivo del descuento" hint={config.maxDiscountPercent != null ? `Obligatorio si supera el ${config.maxDiscountPercent} %` : undefined}>
                <input className={fieldInput} value={values.discountReason} maxLength={500} onChange={(e) => onChange({ discountReason: e.target.value })} />
              </DialogField>
            </div>
          </section>
          {discount && !discount.ok && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{discount.error}</p>}

          <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center text-sm">
            <div><dt className="text-xs text-muted-foreground">Precio base</dt><dd className="font-medium">{formatMoney(base)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Descuento</dt><dd className="font-medium">{discount?.ok ? formatMoney(discount.discountAmount) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Precio final</dt><dd className="text-base font-bold">{discount?.ok ? formatMoney(discount.finalAmount) : "—"}</dd></div>
          </dl>

          {/* Un producto no tiene inicio; con duración arranca al comprar y un evento, en su fecha. */}
          {product && product.timing !== "none" && (
            <DialogField label="Inicio del servicio" hint={serviceStartHint(product.timing)}>
              <input type="date" className={fieldInput} value={values.serviceStartsAt} onChange={(e) => onChange({ serviceStartsAt: e.target.value })} />
            </DialogField>
          )}
        </>
      )}
    </div>
  );
}
