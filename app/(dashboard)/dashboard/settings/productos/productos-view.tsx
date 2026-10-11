"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Layers, Loader2, Package, Plus, X } from "lucide-react";
import { createProduct, setProductStatus } from "@/lib/actions/products";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, TAXONOMY_NAME_MAX, isProductStatus, type ProductStatus } from "@/lib/content/taxonomy";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  piecesLabel,
  sortProducts,
  visibleProducts,
  type ProductRow,
} from "@/lib/sales/catalog/products";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { cn } from "@/lib/utils";

export type { ProductRow };

const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  inactive: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  discontinued: "bg-muted text-muted-foreground",
};

const NOTICE_KEY = "ssa:productos-aviso-contenido";

// El aviso "tus productos de Contenido ya están acá" se muestra hasta que se cierra. Se lee de
// localStorage con useSyncExternalStore: en el servidor se considera cerrado (no aparece de golpe).
const noticeListeners = new Set<() => void>();
function subscribeNotice(listener: () => void) {
  noticeListeners.add(listener);
  return () => void noticeListeners.delete(listener);
}
function noticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}
function dismissNoticeForever() {
  try {
    window.localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* sin almacenamiento: el aviso vuelve a aparecer, no pasa nada */
  }
  noticeListeners.forEach((l) => l());
}

const inputClass =
  "h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

/**
 * Ajustes -> Productos: lo que vende el negocio (lista).
 *
 * Cada producto tiene variantes y, en cada variante, un precio vigente (la
 * versión publicada). NO hay "eliminar": inactivo (pausado) o discontinuado
 * (dejó de venderse) lo sacan de los selectores de venta y de Contenido, pero
 * lo ya vendido o clasificado lo sigue mostrando. El detalle (variantes y
 * precios) está en /dashboard/settings/productos/[id].
 */
export function ProductosView({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dismissed = useSyncExternalStore(subscribeNotice, noticeDismissed, () => true);
  const notice = !dismissed;

  const sorted = sortProducts(products);
  const discontinued = sorted.filter((p) => p.status === "discontinued");
  const shown = visibleProducts(sorted, showDiscontinued);

  function changeStatus(id: string, status: ProductStatus) {
    setError(null);
    start(async () => {
      const result = await setProductStatus({ id, status });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/settings/productos"
        backHref={
          <Link
            href="/dashboard/settings"
            aria-label="Volver a Ajustes"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <SettingsTabs />

      <section aria-labelledby="productos-title" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="productos-title" className="text-base font-semibold">
              Productos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Lo que vendés, con sus variantes y su precio en dólares. Sirve para cargar ventas y para saber qué contenido
              empuja cada producto. Los pilares de tu contenido se administran en la página de Contenido.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo producto
          </button>
        </div>

        {notice && products.length > 0 && (
          <div role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="min-w-0 flex-1">Tus productos de Contenido ya están acá, con su precio.</p>
            <button type="button" onClick={dismissNoticeForever} aria-label="Cerrar el aviso" className="rounded p-0.5 hover:bg-accent hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3">
            <ActionError message={error} />
          </div>
        )}

        {products.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border">
            <SettingsEmptyState
              description={SETTINGS_EMPTY_STATES.contentProducts}
              action={
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Crear el primer producto
                </button>
              }
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {shown.map((product) => (
              <li
                key={product.id}
                className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", product.status !== "active" && "bg-muted/40")}
              >
                <Package className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/dashboard/settings/productos/${product.id}`}
                    className={cn("block truncate text-sm font-medium hover:underline", product.status !== "active" && "text-muted-foreground")}
                  >
                    {product.name}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span className={cn(product.defaultPrice === null && "text-amber-700 dark:text-amber-300")}>{product.priceLabel}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-3 w-3" aria-hidden />
                      {product.variants === 0 ? "Sin variantes" : `${product.variants} ${product.variants === 1 ? "variante" : "variantes"}`}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{piecesLabel(product.pieces)}</span>
                  </p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{PRODUCT_TYPE_LABELS[product.type]}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[product.status])}>
                  {PRODUCT_STATUS_LABEL[product.status]}
                </span>
                <label htmlFor={`status-${product.id}`} className="sr-only">
                  Estado de {product.name}
                </label>
                <select
                  id={`status-${product.id}`}
                  value={product.status}
                  disabled={pending}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (isProductStatus(next)) changeStatus(product.id, next);
                  }}
                  title={
                    product.pieces > 0
                      ? "Deja de ofrecerse al vender y al clasificar, pero las piezas y ventas que lo tienen lo siguen mostrando"
                      : "Un producto inactivo o discontinuado deja de ofrecerse al vender y al clasificar"
                  }
                  className={cn(inputClass, "h-8 px-2 text-xs")}
                >
                  {PRODUCT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PRODUCT_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}

        {discontinued.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDiscontinued((v) => !v)}
            className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showDiscontinued ? "Ocultar discontinuados" : `Mostrar discontinuados (${discontinued.length})`}
          </button>
        )}
      </section>

      {creating && <NewProductDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProductDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof PRODUCT_TYPES)[number]>("otro");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await createProduct({ name, type, description });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      router.push(`/dashboard/settings/productos/${result.data.id}`);
    });
  }

  return (
    <ContentDialog
      title="Nuevo producto"
      label="Nuevo producto"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !name.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Crear producto
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
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={TAXONOMY_NAME_MAX} placeholder="Mentoría 1:1" className={fieldInput} />
      </DialogField>
      <DialogField label="Tipo">
        <select value={type} onChange={(e) => setType(e.target.value as (typeof PRODUCT_TYPES)[number])} className={fieldInput}>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRODUCT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogField label="Descripción (opcional)" hint="Se crea con una variante «Estándar»: después le cargás el precio y la publicás.">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} className={fieldInput} />
      </DialogField>
    </ContentDialog>
  );
}
