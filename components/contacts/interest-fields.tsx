"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setContactInterest } from "@/lib/actions/contact-interest";
import { offeredProducts, offeredVariants, type InterestCatalog } from "@/lib/contacts/interest";
import { ActionError } from "./ui";

/**
 * El producto de interés y su variante opcional. Se guarda al cambiar el
 * desplegable. Cambiar el producto borra la variante (era de otro producto).
 */
export function InterestFields({
  contactId,
  catalog,
  productId,
  variantId,
  canEdit,
  onSaved,
}: {
  contactId: string;
  catalog: InterestCatalog;
  productId: string | null;
  variantId: string | null;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const products = offeredProducts(catalog, productId);
  const variants = offeredVariants(catalog, productId, variantId);
  const archivedSuffix = (archived: boolean) => (archived ? " (archivado)" : "");

  function save(nextProduct: string | null, nextVariant: string | null) {
    start(async () => {
      const result = await setContactInterest(contactId, nextProduct, nextVariant);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
      onSaved?.();
    });
  }

  const selectClass =
    "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

  if (catalog.length === 0) {
    return <p className="text-xs text-muted-foreground">Todavía no hay productos. Se cargan en Ajustes → Productos.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`interest-product-${contactId}`} className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Producto
          {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        </label>
        <select
          id={`interest-product-${contactId}`}
          value={productId ?? ""}
          disabled={!canEdit || pending}
          onChange={(e) => save(e.target.value || null, null)}
          className={selectClass}
        >
          <option value="">Sin producto</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {archivedSuffix(p.archived)}
            </option>
          ))}
        </select>
      </div>
      {productId && variants.length > 0 && (
        <div>
          <label htmlFor={`interest-variant-${contactId}`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Variante (opcional)
          </label>
          <select
            id={`interest-variant-${contactId}`}
            value={variantId ?? ""}
            disabled={!canEdit || pending}
            onChange={(e) => save(productId, e.target.value || null)}
            className={selectClass}
          >
            <option value="">Cualquiera</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {archivedSuffix(v.archived)}
              </option>
            ))}
          </select>
        </div>
      )}
      <ActionError message={error} />
    </div>
  );
}
