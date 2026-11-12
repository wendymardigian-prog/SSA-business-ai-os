// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Layers, Loader2, Plus, Route } from "lucide-react";
import { createProduct } from "@/lib/actions/products";
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS } from "@/lib/catalog/products";
import { TAXONOMY_NAME_MAX } from "@/lib/content/taxonomy";
import { productCardView } from "@/lib/services/screens/product-cards";
import type { ServiceProduct } from "@/lib/services/screens/load-products";
import { ActionError } from "@/components/contacts/ui";
import { ContentDialog, DialogField, fieldInput } from "@/components/content/dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { CapacityButton } from "./capacity-panel";
import { cn } from "@/lib/utils";

/**
 * Ajustes › Productos con el módulo de Servicios prendido (F114, nivel 1): una tarjeta por producto con su portal,
 * sus variantes, el rango de precios, los servicios activos y cuántas variantes tienen camino, y la tarjeta
 * «Nuevo producto». Con el módulo apagado la página sigue mostrando la lista de siempre.
 */
export function ProductCardsView({ products, canConfigure = false }: { products: ServiceProduct[]; canConfigure?: boolean }) {
  const [creating, setCreating] = useState(false);
  const cards = products.map(productCardView);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Productos" tooltip="Lo que vende el negocio. Cada variante decide si crea un servicio, su camino y su portal." tabs={<SettingsTabs />} more={canConfigure ? <CapacityButton /> : undefined} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.id}>
                <Link
                  href={c.href}
                  className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.typeLabel} · {c.statusLabel}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        c.portalOn ? "bg-primary/10 text-primary-ink" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {c.portalLabel}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{c.priceLabel}</p>
                  <dl className="mt-auto grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" aria-hidden />
                      <dt className="sr-only">Variantes</dt>
                      <dd>{c.variantsLabel}</dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <GraduationCap className="h-3.5 w-3.5" aria-hidden />
                      <dt className="sr-only">Servicios activos</dt>
                      <dd>{c.activeServices} activos</dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <Route className="h-3.5 w-3.5" aria-hidden />
                      <dt className="sr-only">Variantes con camino</dt>
                      <dd>{c.journeyLabel ?? "Sin camino"}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-edge"
              >
                <Plus className="h-5 w-5" aria-hidden />
                Nuevo producto
              </button>
            </li>
          </ul>
          {cards.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">Todavía no hay productos. Creá el primero para cargarle sus variantes y su precio.</p>
          )}
        </div>
      </div>
      {creating && <NewProductDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProductDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(PRODUCT_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await createProduct({ name, type });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/settings/productos/${res.data.id}`);
    });
  }

  return (
    <ContentDialog
      title="Nuevo producto"
      label="Nuevo producto"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={submit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Crear
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogField label="Nombre">
          <input id="new-product-name" value={name} maxLength={TAXONOMY_NAME_MAX} onChange={(e) => setName(e.target.value)} className={fieldInput} />
        </DialogField>
        <DialogField label="Tipo">
          <select id="new-product-type" value={type} onChange={(e) => setType(e.target.value)} className={fieldInput}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PRODUCT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </DialogField>
        {error && <ActionError message={error} />}
      </div>
    </ContentDialog>
  );
}
