"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { createProduct, updateProduct } from "@/lib/actions/content-taxonomy";
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABEL,
  TAXONOMY_NAME_MAX,
  checkPrice,
  formatPriceUsd,
  isProductStatus,
  type ProductStatus,
} from "@/lib/content/taxonomy";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { cn } from "@/lib/utils";

export interface ProductRow {
  id: string;
  name: string;
  /** USD. null = un producto anterior a la 00134, que todavia no tiene precio cargado. */
  priceUsd: number | null;
  status: ProductStatus;
  /** Cuantas piezas lo usan. */
  pieces: number;
}

const STATUS_ORDER: Record<ProductStatus, number> = { active: 0, inactive: 1, discontinued: 2 };

const STATUS_BADGE: Record<ProductStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  inactive: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  discontinued: "bg-muted text-muted-foreground",
};

const inputClass =
  "h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

/**
 * Ajustes -> Productos: lo que vende el negocio.
 *
 * Cada producto tiene SIEMPRE un precio (en USD) y un estado: activo (se
 * ofrece al clasificar una idea o una pieza), inactivo (pausado) o
 * discontinuado (dejo de venderse). NO hay "eliminar": una pieza ya
 * clasificada sigue mostrando su producto aunque ya no se ofrezca.
 */
export function ProductosView({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sorted = [...products].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "es"),
  );
  const discontinued = sorted.filter((p) => p.status === "discontinued");
  const shown = showDiscontinued ? sorted : sorted.filter((p) => p.status !== "discontinued");
  const priceCheck = checkPrice(price);

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>, onDone?: () => void) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function add() {
    if (!name.trim() || !priceCheck.ok) return;
    run(
      () => createProduct({ name, priceUsd: price }),
      () => {
        setName("");
        setPrice("");
      },
    );
  }

  function saveEdit(id: string) {
    run(() => updateProduct({ id, name: editName, priceUsd: editPrice }), () => setEditingId(null));
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
        <h2 id="productos-title" className="text-base font-semibold">
          Productos
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que vendés, con su precio en dólares. Sirve para saber qué contenido empuja cada producto. Los pilares de
          tu contenido se administran en la página de Contenido, con el botón de ajustes.
        </p>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label htmlFor="new-product-name" className="sr-only">
            Nombre del producto nuevo
          </label>
          <input
            id="new-product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TAXONOMY_NAME_MAX}
            placeholder="Nuevo producto"
            className={cn(inputClass, "flex-1")}
          />
          <label htmlFor="new-product-price" className="sr-only">
            Precio en USD
          </label>
          <div className="relative sm:w-40">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">USD</span>
            <input
              id="new-product-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="Precio"
              className={cn(inputClass, "w-full pl-11")}
            />
          </div>
          <button
            type="submit"
            disabled={pending || !name.trim() || !priceCheck.ok}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </button>
        </form>
        {price.trim() !== "" && !priceCheck.ok && (
          <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {priceCheck.error}
          </p>
        )}

        {error && (
          <div className="mt-3">
            <ActionError message={error} />
          </div>
        )}

        {products.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border">
            <SettingsEmptyState description={SETTINGS_EMPTY_STATES.contentProducts} />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {shown.map((product) => (
              <li
                key={product.id}
                className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", product.status !== "active" && "bg-muted/40")}
              >
                {editingId === product.id ? (
                  <form
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveEdit(product.id);
                    }}
                  >
                    <label htmlFor={`edit-name-${product.id}`} className="sr-only">
                      Nombre del producto
                    </label>
                    <input
                      id={`edit-name-${product.id}`}
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={TAXONOMY_NAME_MAX}
                      className={cn(inputClass, "h-8 min-w-[10rem] flex-1 px-2")}
                    />
                    <label htmlFor={`edit-price-${product.id}`} className="sr-only">
                      Precio en USD
                    </label>
                    <input
                      id={`edit-price-${product.id}`}
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder="Precio (USD)"
                      className={cn(inputClass, "h-8 w-32 px-2")}
                    />
                    <button
                      type="submit"
                      aria-label="Guardar"
                      disabled={pending || !checkPrice(editPrice).ok || !editName.trim()}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancelar"
                      onClick={() => setEditingId(null)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", product.status !== "active" && "text-muted-foreground")}>
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className={cn(product.priceUsd === null && "text-amber-700 dark:text-amber-300")}>
                          {formatPriceUsd(product.priceUsd)}
                        </span>
                        {" · "}
                        {product.pieces === 0 ? "Sin piezas" : `${product.pieces} ${product.pieces === 1 ? "pieza" : "piezas"}`}
                      </p>
                    </div>
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
                        if (isProductStatus(next)) run(() => updateProduct({ id: product.id, status: next }));
                      }}
                      title={
                        product.pieces > 0
                          ? "Deja de ofrecerse al clasificar, pero las piezas que lo tienen lo siguen mostrando"
                          : "Un producto inactivo o discontinuado deja de ofrecerse al clasificar"
                      }
                      className={cn(inputClass, "h-8 px-2 text-xs")}
                    >
                      {PRODUCT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {PRODUCT_STATUS_LABEL[status]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Editar ${product.name}`}
                      onClick={() => {
                        setError(null);
                        setEditName(product.name);
                        setEditPrice(product.priceUsd === null ? "" : String(product.priceUsd));
                        setEditingId(product.id);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
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
    </div>
  );
}
