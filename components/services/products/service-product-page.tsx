// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Copy, Loader2, Pencil, Plus, Undo2 } from "lucide-react";
import { archiveVariant, duplicateVariant, restoreVariant, setProductStatus, updateProduct } from "@/lib/actions/products";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, TAXONOMY_NAME_MAX, isProductStatus } from "@/lib/content/taxonomy";
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/catalog/products";
import { productCardView, variantRowView } from "@/lib/services/screens/product-cards";
import type { ServiceProduct, ServiceVariant } from "@/lib/services/screens/load-products";
import type { CatalogVariant } from "@/lib/catalog/load";
import { ActionError } from "@/components/contacts/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { Historial } from "@/components/historial/historial";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { VariantDialog, emptyVariantForm, type VariantFormValues } from "@/components/catalog/variant-dialog";
import { formFrom } from "@/components/catalog/product-detail";
import { cn } from "@/lib/utils";

/** La variante en la forma que pide el diálogo de siempre. */
export function asCatalogVariant(v: ServiceVariant): CatalogVariant {
  return {
    id: v.id,
    name: v.name,
    duration_type: v.durationType,
    duration_value: v.durationValue,
    event_date: v.eventDate,
    billing_type: v.billingType,
    billing_interval: v.billingInterval,
    display_order: v.displayOrder,
    archived_at: v.archived ? "x" : null,
    price: v.rawPrice,
    activePrice: v.price,
  };
}

/**
 * Ajustes › Productos › un producto, con el módulo prendido (F114, nivel 2): nombre, tipo, chip de portal y
 * «Editar producto»; la tarjeta Variantes (precio, «Al cobrarse», camino, portal y servicios activos; cada fila abre
 * la variante) y el historial del producto.
 */
export function ServiceProductPage({ product, userNames, timeZone, linksCard }: { product: ServiceProduct; userNames: Record<string, string>; timeZone: string; /** La tarjeta Links (afiliados, F70), si la persona puede editarla. */ linksCard?: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [variantForm, setVariantForm] = useState<VariantFormValues | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const card = productCardView(product);
  const rows = product.variants.map((v) => variantRowView(product.id, v));
  const liveCount = rows.filter((r) => !r.archived).length;

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await task();
      if (!res.ok) setError(res.error ?? "No se pudo hacer");
      else router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        tabs={<SettingsTabs />}
        title={product.name}
        tooltip="Las variantes del producto. Cada una decide si crea un servicio, su camino, su portal y su precio."
        backHref={
          <Link href="/dashboard/settings/productos" aria-label="Volver a Productos" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-8">
          <nav aria-label="Migas" className="text-sm text-muted-foreground">
            <Link href="/dashboard/settings/productos" className="hover:text-foreground">
              Productos
            </Link>{" "}
            › <span className="text-foreground">{product.name}</span>
          </nav>

          <header className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 truncate text-lg font-semibold">{product.name}</h1>
            <span className="text-sm text-muted-foreground">
              {product.typeLabel} · {product.statusLabel}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", card.portalOn ? "bg-primary/10 text-primary-ink" : "bg-muted text-muted-foreground")}>
              {card.portalLabel}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Editar producto
            </button>
          </header>
          {product.description && <p className="-mt-3 text-sm text-muted-foreground">{product.description}</p>}
          {error && <ActionError message={error} />}

          <section aria-labelledby="variantes-title" className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 id="variantes-title" className="text-sm font-semibold">
                Variantes
              </h2>
              <button
                type="button"
                onClick={() => setVariantForm(emptyVariantForm(product.type))}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Variante
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Este producto todavía no tiene variantes. Creá la primera con «+ Variante».</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Variante</th>
                      <th className="px-4 py-2 font-medium">Precio</th>
                      <th className="px-4 py-2 font-medium">Al cobrarse</th>
                      <th className="px-4 py-2 font-medium">Camino</th>
                      <th className="px-4 py-2 font-medium">Portal</th>
                      <th className="px-4 py-2 font-medium">Activos</th>
                      <th className="px-4 py-2" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const v = product.variants.find((x) => x.id === r.id)!;
                      return (
                        <tr key={r.id} className={cn("border-t border-border", r.archived && "opacity-60")}>
                          <td className="px-4 py-2.5">
                            <Link href={r.href} className="font-medium text-foreground hover:underline">
                              {r.name}
                            </Link>
                            {r.archived && <span className="ml-2 text-xs text-muted-foreground">Archivada</span>}
                          </td>
                          <td className="px-4 py-2.5">{r.priceLabel}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.modeLabel}</td>
                          <td className={cn("px-4 py-2.5", r.journeyMissing ? "font-medium text-warn" : "text-muted-foreground")}>{r.journeyLabel}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.portalLabel}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.activeServices}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end gap-1">
                              <button type="button" onClick={() => setVariantForm(formFrom(asCatalogVariant(v), product.type))} aria-label={`Editar ${r.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button type="button" disabled={pending} onClick={() => run(() => duplicateVariant(r.id))} aria-label={`Duplicar ${r.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              {r.archived ? (
                                <button type="button" disabled={pending} onClick={() => run(() => restoreVariant(r.id))} aria-label={`Restaurar ${r.name}`} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => (liveCount <= 1 ? setConfirmArchive(r.id) : run(() => archiveVariant(r.id)))}
                                  aria-label={`Archivar ${r.name}`}
                                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <Archive className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {linksCard}

          <section aria-label="Historial del producto" className="rounded-xl border border-border p-4">
            <h3 className="mb-3 text-sm font-semibold">Historial del producto</h3>
            <Historial entityType="product" entityId={product.id} names={{ users: userNames }} timeZone={timeZone} pageSize={10} />
          </section>
        </div>
      </div>

      {variantForm && <VariantDialog productId={product.id} productType={product.type} initial={variantForm} onClose={() => setVariantForm(null)} />}
      {editing && <EditProductDialog product={product} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={!!confirmArchive}
        title="Archivar la única variante"
        message="Es la única variante activa de este producto: si la archivás, el producto deja de poder venderse hasta que crees o restaures otra."
        confirmLabel="Archivar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          const id = confirmArchive;
          setConfirmArchive(null);
          if (id) run(() => archiveVariant(id));
        }}
        onCancel={() => setConfirmArchive(null)}
      />
    </div>
  );
}

function EditProductDialog({ product, onClose }: { product: ServiceProduct; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(product.name);
  const [type, setType] = useState(product.type);
  const [status, setStatus] = useState(product.status);
  const [description, setDescription] = useState(product.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await updateProduct({ id: product.id, name, type, description });
      if (!res.ok) return setError(res.error);
      if (status !== product.status && isProductStatus(status)) {
        const st = await setProductStatus({ id: product.id, status });
        if (!st.ok) return setError(st.error);
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      title="Editar producto"
      label="Editar producto"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button type="button" disabled={pending || !name.trim()} onClick={save} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogField label="Nombre">
          <input value={name} maxLength={TAXONOMY_NAME_MAX} onChange={(e) => setName(e.target.value)} className={fieldInput} />
        </DialogField>
        <DialogField label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value)} className={fieldInput}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Estado">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldInput}>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PRODUCT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField label="Descripción">
          <textarea value={description} rows={3} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={fieldInput} />
        </DialogField>
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
