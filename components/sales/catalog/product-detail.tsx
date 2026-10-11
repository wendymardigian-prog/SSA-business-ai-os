"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Layers, Loader2, Pencil, Plus, Save, Undo2, Archive } from "lucide-react";
import { archiveVariant, duplicateVariant, restoreVariant, setProductStatus, updateProduct } from "@/lib/actions/products";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, TAXONOMY_NAME_MAX, isProductStatus } from "@/lib/content/taxonomy";
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/sales/catalog/products";
import { archiveLeavesProductUnsellable, variantRow } from "@/lib/sales/catalog/variants";
import type { ProductDetailData, VariantWithVersions } from "@/lib/sales/catalog/load";
import { ActionError } from "@/components/contacts/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContentDialog, fieldInput } from "@/components/content/dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { EMPTY_VARIANT_FORM, VariantDialog, type VariantFormValues } from "./variant-dialog";
import { VariantPriceTab } from "./variant-price-tab";

type VariantTab = "precio";

function formFrom(v: VariantWithVersions): VariantFormValues {
  return {
    id: v.id,
    name: v.name,
    durationType: v.duration_type,
    durationValue: v.duration_value === null ? "" : String(v.duration_value),
    guaranteeType: v.guarantee_duration_type ?? "",
    guaranteeValue: v.guarantee_duration_value === null ? "" : String(v.guarantee_duration_value),
    billingType: v.billing_type,
    billingInterval: v.billing_interval ?? "",
    priceUsd: "",
  };
}

/**
 * Ajustes -> Productos -> un producto (plano F3, F4): el nombre, el tipo y el
 * estado arriba, y las variantes abajo. El detalle de una variante se arma con
 * pestañas desde el principio (hoy una sola, «Precio»): CX va a sumar la suya.
 */
export function ProductDetail({
  product,
  userNames,
  timeZone,
}: {
  product: ProductDetailData;
  userNames: Record<string, string>;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(product.name);
  const [editingDescription, setEditingDescription] = useState(false);
  const [variantForm, setVariantForm] = useState<VariantFormValues | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const firstLive = product.variants.find((v) => !v.archived_at) ?? product.variants[0];
  const [selectedId, setSelectedId] = useState<string | null>(firstLive?.id ?? null);
  const [tab, setTab] = useState<VariantTab>("precio");

  const selected = product.variants.find((v) => v.id === selectedId) ?? null;
  const dirty = name.trim() !== product.name;
  const rows = useMemo(() => new Map(product.variants.map((v) => [v.id, variantRow(v, v.activePrice)])), [product.variants]);

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, then?: () => void) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      then?.();
      router.refresh();
    });
  }

  function askArchive(id: string) {
    if (archiveLeavesProductUnsellable(product.variants, id)) setConfirmArchive(id);
    else run(() => archiveVariant(id));
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={product.name}
        tooltip="Las variantes del producto y, en cada una, su precio vigente y el historial de precios."
        backHref={
          <Link
            href="/dashboard/settings/productos"
            aria-label="Volver a Productos"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <SettingsTabs />

      <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-8">
        {/* Encabezado del producto */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
            <label htmlFor="product-name" className="sr-only">
              Nombre del producto
            </label>
            <input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={TAXONOMY_NAME_MAX}
              className="h-10 min-w-0 flex-1 rounded-lg sm:max-w-xs border border-transparent bg-transparent px-2 text-lg font-semibold hover:border-border focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setEditingDescription(true)}
              title="Editar descripción"
              aria-label="Editar la descripción"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            {dirty && (
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() => run(() => updateProduct({ id: product.id, name }))}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                Guardar
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Tipo
            <select
              value={product.type}
              disabled={pending}
              onChange={(e) => run(() => updateProduct({ id: product.id, type: e.target.value }))}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PRODUCT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Estado
            <select
              value={product.status}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value;
                if (isProductStatus(next)) run(() => setProductStatus({ id: product.id, status: next }));
              }}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PRODUCT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {product.description && <p className="-mt-3 px-2 text-sm text-muted-foreground">{product.description}</p>}

        {error && <ActionError message={error} />}

        {/* Variantes */}
        <section aria-labelledby="variantes-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="variantes-title" className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
              Variantes
            </h2>
            <button
              type="button"
              onClick={() => setVariantForm({ ...EMPTY_VARIANT_FORM })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nueva variante
            </button>
          </div>

          {product.variants.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Este producto todavía no tiene variantes. Creá la primera para poder cargarle un precio.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {product.variants.map((variant) => {
                const row = rows.get(variant.id)!;
                const isSelected = variant.id === selectedId;
                return (
                  <li key={variant.id}>
                    <div
                      className={cn(
                        "rounded-lg border p-3 transition-colors",
                        isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40",
                        row.archived && "opacity-60",
                      )}
                    >
                      <button type="button" onClick={() => setSelectedId(variant.id)} className="block w-full text-left" aria-pressed={isSelected}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{variant.name}</span>
                          <span className={cn("shrink-0 text-sm font-semibold", !row.sellable && "text-amber-700 dark:text-amber-300")}>{row.priceLabel}</span>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.duration} · {row.billing} · {row.guarantee}
                          {row.archived ? " · Archivada" : ""}
                        </span>
                      </button>
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => setVariantForm(formFrom(variant))}
                          aria-label={`Editar ${variant.name}`}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => run(() => duplicateVariant(variant.id), () => undefined)}
                          disabled={pending}
                          aria-label={`Duplicar ${variant.name}`}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {row.archived ? (
                          <button
                            type="button"
                            onClick={() => run(() => restoreVariant(variant.id))}
                            disabled={pending}
                            aria-label={`Restaurar ${variant.name}`}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => askArchive(variant.id)}
                            disabled={pending}
                            aria-label={`Archivar ${variant.name}`}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                        {pending && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Detalle de la variante, con pestañas */}
        {selected && (
          <section aria-label={`Detalle de ${selected.name}`} className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-sm font-semibold">{selected.name}</h3>
            <Tabs tabs={[{ value: "precio", label: "Precio" }]} value={tab} onChange={setTab} label="Detalle de la variante">
              <VariantPriceTab
                key={selected.id}
                variantId={selected.id}
                versions={selected.versions}
                salesByVersion={selected.salesByVersion}
                userNames={userNames}
                timeZone={timeZone}
              />
            </Tabs>
          </section>
        )}
      </div>
      </div>

      {variantForm && <VariantDialog productId={product.id} initial={variantForm} onClose={() => setVariantForm(null)} />}
      {editingDescription && (
        <DescriptionDialog
          productId={product.id}
          initial={product.description ?? ""}
          onClose={() => setEditingDescription(false)}
        />
      )}
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

function DescriptionDialog({ productId, initial, onClose }: { productId: string; initial: string; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await updateProduct({ id: productId, description: text });
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
      title="Descripción del producto"
      label="Descripción del producto"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Guardar
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
      <label className="block space-y-1">
        <span className="text-xs font-medium">Descripción</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} className={fieldInput} />
      </label>
    </ContentDialog>
  );
}
