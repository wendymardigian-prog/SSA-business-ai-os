"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { updateSale, type SaleActionResult } from "@/lib/actions/sales";
import { setSaleAffiliate } from "@/lib/actions/affiliates";
import { AffiliateEditFields, AffiliateName, affiliateSummary, initialAffiliateEdit, type AffiliateEditValue } from "@/components/affiliates/affiliate-field";
import type { AffiliateOfRecord } from "@/lib/affiliates/load";
import { SaleModal } from "@/components/shared/sale-modal";
import { AttributionField } from "@/components/sales/attribution-field";
import { ContactSearch } from "@/components/sales/wizard/step1-contact";
import { discountState } from "@/components/sales/wizard/step2-product";
import type { WizardConfig } from "@/components/sales/wizard/types";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { DEFAULT_ATTRIBUTION_STATE, type AttributionFieldState } from "@/lib/sales/attribution-field";
import { isLockedForEdit, LOCKED_REASON } from "@/lib/sales/edit";
import { formatMoney } from "@/lib/shared/format";
import { snapshotProductId } from "@/lib/sales/sale-text";

export interface EditableSale {
  id: string;
  contact_id: string;
  status: string;
  setter_id: string | null;
  vendedor_id: string | null;
  base_amount: unknown;
  discount_amount: unknown;
  discount_reason: string | null;
  product_snapshot: unknown;
  product_variant_id: string;
  notes: string | null;
  service_starts_at: string | null;
  attribution_line: string;
  updated_at: string;
}

/**
 * Editar una venta (F26). Una venta cancelada, reembolsada o en disputa solo deja cambiar las
 * notas. Cambiar el producto o el precio con cobros pide una confirmación y un motivo: lo
 * cobrado no se toca y, si el plan deja de cuadrar, la ficha ofrece «Rearmar el plan».
 *
 * El afiliado (`affiliate`, solo con `affiliates.assign`) se guarda aparte con `setSaleAffiliate`, DESPUÉS de la venta: su
 * UPDATE cambia `updated_at` y, al revés, `updateSale` daría conflicto. Sin `sales.manage` (`canEditSale` falso) la
 * ventana muestra solo el afiliado.
 */
export function SaleEditDialog({ sale, contactName, config, onClose, openAttribution = false, canEditSale = true, affiliate }: { sale: EditableSale; contactName: string; config: WizardConfig; onClose: () => void; openAttribution?: boolean; canEditSale?: boolean; affiliate?: AffiliateOfRecord }) {
  const router = useRouter();
  const locked = isLockedForEdit(sale.status);
  const productId = snapshotProductId(sale.product_snapshot) ?? "";
  const currentVariantId = ((sale.product_snapshot ?? {}) as { variant_id?: string }).variant_id ?? "";

  const [contact, setContact] = useState<{ id: string; name: string }>({ id: sale.contact_id, name: contactName });
  const [changingContact, setChangingContact] = useState(false);
  const [setterId, setSetterId] = useState(sale.setter_id);
  const [vendedorId, setVendedorId] = useState(sale.vendedor_id);
  const [attribution, setAttribution] = useState<AttributionFieldState>(DEFAULT_ATTRIBUTION_STATE);
  const [attributionTouched, setAttributionTouched] = useState(false);
  const [editAttribution, setEditAttribution] = useState(openAttribution);
  const [prodId, setProdId] = useState(productId);
  const [variantId, setVariantId] = useState(currentVariantId);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const initialDiscount = Number(sale.discount_amount) > 0 ? String(Number(sale.discount_amount)) : "";
  const [discountValue, setDiscountValue] = useState(initialDiscount);
  const [discountReason, setDiscountReason] = useState(sale.discount_reason ?? "");
  const [notes, setNotes] = useState(sale.notes ?? "");
  const [serviceStart, setServiceStart] = useState(sale.service_starts_at ?? "");
  const [confirm, setConfirm] = useState<{ paid: number } | null>(null);
  const [repriceReason, setRepriceReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const [affMode, setAffMode] = useState<"keep" | "change" | "remove">("keep");
  const [affEdit, setAffEdit] = useState<AffiliateEditValue>(() => (affiliate ? initialAffiliateEdit(affiliate) : { picked: null, kind: "influenced", expiresAt: "", reason: "" }));
  // Si la venta ya se guardó y falló solo el afiliado, reintentar no vuelve a mandar la venta (daría conflicto).
  const [saleSaved, setSaleSaved] = useState(false);

  const product = config.catalog.find((p) => p.id === prodId) ?? null;
  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const variantChanged = variantId !== currentVariantId && !!variantId;
  const base = variantChanged ? variant?.price ?? 0 : Number(sale.base_amount) || 0;
  const discountChanged = discountValue !== initialDiscount || discountReason !== (sale.discount_reason ?? "");
  const pricingChanged = variantChanged || discountChanged;
  const discount = discountState(config, base, { productId: prodId, variantId, discountType, discountValue, discountReason, serviceStartsAt: "" });

  function submit(confirmed = false) {
    setError(null);
    const affiliateChanged = !!affiliate && affMode !== "keep";
    if (affiliateChanged) {
      if (affMode === "change" && !affEdit.picked) return setError("Elegí el afiliado");
      if (!affEdit.reason.trim()) return setError("Escribí el motivo del cambio de afiliado");
    }
    const raw = Number(discountValue);
    const changes = {
      ...(contact.id !== sale.contact_id ? { contactId: contact.id } : {}),
      ...(setterId !== sale.setter_id ? { setterId } : {}),
      ...(vendedorId !== sale.vendedor_id ? { vendedorId } : {}),
      ...(attributionTouched ? { attribution } : {}),
      ...(pricingChanged ? { discount: discountValue.trim() && raw > 0 ? { type: discountType, value: raw } : null, discountReason: discountReason.trim() || null } : {}),
      ...(variantChanged && variant?.price != null ? { variantId: variant.id, shownPrice: variant.price } : {}),
      ...(notes !== (sale.notes ?? "") ? { notes } : {}),
      ...(serviceStart !== (sale.service_starts_at ?? "") ? { serviceStartsAt: serviceStart || null } : {}),
      ...(confirmed ? { confirmRepricing: true, repricingReason: repriceReason } : {}),
    };
    const saleChanged = canEditSale && !saleSaved && Object.keys(changes).length > 0;
    if (!saleChanged && !affiliateChanged) return onClose();
    start(async () => {
      if (saleChanged) {
        const result: SaleActionResult = await updateSale({ saleId: sale.id, expectedUpdatedAt: sale.updated_at, ...changes });
        if (!result.ok) {
          if (result.code === "confirm_required") return setConfirm({ paid: result.paidAmount ?? 0 });
          if (result.code === "conflict") setConflict(true);
          return setError(result.error);
        }
        setSaleSaved(true);
      }
      if (affiliateChanged) {
        const ref = affMode === "remove" || !affEdit.picked ? null : { type: affEdit.picked.type, id: affEdit.picked.id };
        const res = await setSaleAffiliate(sale.id, ref, { kind: affMode === "remove" ? null : affEdit.kind, reason: affEdit.reason });
        if (!res.ok) {
          router.refresh();
          return setError(saleChanged || saleSaved ? `La venta se guardó, pero el afiliado no: ${res.error.message}` : res.error.message);
        }
      }
      onClose();
      router.refresh();
    });
  }

  const currentAffiliate = affiliate?.affiliate ?? null;
  const currentSummary = affiliate ? affiliateSummary(affiliate, "sale") : "";
  const affiliateSection = affiliate ? (
    <section aria-label="Afiliado" className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Afiliado</h3>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="min-w-0 flex-1">
          {currentAffiliate ? <><AffiliateName affiliate={currentAffiliate} />{currentSummary && <span className="ml-2 text-xs text-muted-foreground">{currentSummary}</span>}</> : <span className="text-muted-foreground">Sin afiliado</span>}
        </span>
        {affMode === "keep" ? (
          <>
            <button type="button" onClick={() => setAffMode("change")} className="text-xs font-medium text-primary-ink underline-offset-2 hover:underline">{currentAffiliate ? "Cambiar" : "Asignar"}</button>
            {currentAffiliate && <button type="button" onClick={() => setAffMode("remove")} className="text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400">Quitar</button>}
          </>
        ) : (
          <button type="button" onClick={() => { setAffMode("keep"); setAffEdit({ ...affEdit, picked: null, reason: "" }); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3 w-3" aria-hidden /> No cambiar el afiliado</button>
        )}
      </div>
      {affMode === "change" && <AffiliateEditFields target="sale" value={affEdit} onChange={setAffEdit} disabled={pending} />}
      {affMode === "remove" && (
        <DialogField label="Motivo para quitar el afiliado">
          <textarea className={fieldInput} rows={2} value={affEdit.reason} disabled={pending} onChange={(e) => setAffEdit({ ...affEdit, reason: e.target.value })} placeholder="Por qué se quita" />
        </DialogField>
      )}
    </section>
  ) : null;

  return (
    <SaleModal
      size="lg"
      title={canEditSale ? "Editar venta" : "Cambiar el afiliado"}
      label={canEditSale ? "Editar venta" : "Cambiar el afiliado"}
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <div className="ml-auto flex gap-2">
            {conflict ? (
              <button type="button" onClick={() => { onClose(); router.refresh(); }} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Recargar</button>
            ) : (
              <>
                <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
                <button type="button" disabled={pending || (!!confirm && !repriceReason.trim()) || (pricingChanged && !discount.ok)} onClick={() => submit(!!confirm)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {confirm ? "Confirmar el cambio de precio" : "Guardar"}
                </button>
              </>
            )}
          </div>
        </>
      }
    >
      {!canEditSale ? affiliateSection : (<>
      {locked && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">{LOCKED_REASON[sale.status]}</p>}

      <section aria-label="Contacto" className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacto</h3>
        {changingContact ? <ContactSearch onPick={(c) => { setContact(c); setChangingContact(false); }} onCreate={() => setChangingContact(false)} /> : (
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{contact.name}</span>
            {!locked && <button type="button" onClick={() => setChangingContact(true)} className="text-xs font-medium text-primary-ink underline-offset-2 hover:underline">Cambiar</button>}
          </div>
        )}
      </section>

      <section aria-label="Asignaciones" className="grid gap-3 sm:grid-cols-2">
        {([["Setter", setterId, setSetterId], ["Vendedor", vendedorId, setVendedorId]] as const).map(([label, value, set]) => (
          <DialogField key={label} label={label}>
            <select className={fieldInput} disabled={locked} value={value ?? ""} onChange={(e) => set(e.target.value || null)}>
              <option value="">Sin asignar</option>
              {config.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </DialogField>
        ))}
      </section>

      {affiliateSection}

      <section aria-label="Atribución" className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atribución</h3>
        <p className="text-sm">{sale.attribution_line}</p>
        {!locked && (editAttribution ? (
          <AttributionField contactId={contact.id} value={attribution} onChange={(a) => { setAttribution(a); setAttributionTouched(true); }} timeZone={config.timeZone} members={config.members} autoSuggest={false} />
        ) : (
          <button type="button" onClick={() => setEditAttribution(true)} className="h-8 rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent">Cambiar la atribución</button>
        ))}
        {attributionTouched && <p className="text-[11px] text-muted-foreground">Al guardar queda como «manual» y el cambio queda en el historial con el valor anterior.</p>}
      </section>

      <section aria-label="Producto y precio" className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Producto y precio</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <DialogField label="Producto">
            <select className={fieldInput} disabled={locked} value={prodId} onChange={(e) => { setProdId(e.target.value); setVariantId(e.target.value === productId ? currentVariantId : ""); }}>
              {!product && <option value={prodId}>{prodId ? "Producto actual (ya no se ofrece)" : "Elegí un producto"}</option>}
              {config.catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </DialogField>
          <DialogField label="Variante">
            <select className={fieldInput} disabled={locked || !product} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              <option value="">Elegí una variante</option>
              {product?.variants.map((v) => <option key={v.id} value={v.id} disabled={!!v.unavailable}>{v.name}{v.price != null ? ` — ${formatMoney(v.price)}` : ""}</option>)}
            </select>
          </DialogField>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <DialogField label="Descuento">
            <div className="flex gap-1">
              <select aria-label="Tipo de descuento" className={`${fieldInput} w-24`} disabled={locked} value={discountType} onChange={(e) => setDiscountType(e.target.value as "amount" | "percent")}>
                <option value="amount">$</option>
                <option value="percent">%</option>
              </select>
              <input type="number" min={0} step="0.01" className={fieldInput} disabled={locked} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} aria-label="Valor del descuento" />
            </div>
          </DialogField>
          <div className="sm:col-span-2">
            <DialogField label="Motivo del descuento">
              <input className={fieldInput} disabled={locked} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} maxLength={500} />
            </DialogField>
          </div>
        </div>
        {pricingChanged && !locked && (
          discount.ok
            ? <p className="text-xs text-muted-foreground">Precio final: <strong>{formatMoney(discount.finalAmount)}</strong> (base {formatMoney(base)}). Lo ya cobrado no se toca.</p>
            : <p role="alert" className="text-xs text-red-700 dark:text-red-400">{discount.error}</p>
        )}
      </section>

      <section aria-label="Otros datos" className="grid gap-3 sm:grid-cols-2">
        <DialogField label="Inicio del servicio">
          <input type="date" className={fieldInput} disabled={locked} value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} />
        </DialogField>
        <div className="sm:col-span-2">
          <DialogField label="Notas internas">
            <textarea className={fieldInput} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </DialogField>
        </div>
      </section>

      {confirm && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p>Ya se cobró <strong>{formatMoney(confirm.paid)}</strong> de esta venta. Cambiar el precio no modifica lo cobrado y el plan puede quedar descuadrado. Contanos por qué:</p>
          <textarea className={fieldInput} rows={2} maxLength={500} value={repriceReason} onChange={(e) => setRepriceReason(e.target.value)} aria-label="Motivo del cambio de precio" placeholder="Motivo del cambio de precio" />
          <button type="button" onClick={() => setConfirm(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3 w-3" aria-hidden /> No cambiar el precio</button>
        </div>
      )}
      </>)}
    </SaleModal>
  );
}
