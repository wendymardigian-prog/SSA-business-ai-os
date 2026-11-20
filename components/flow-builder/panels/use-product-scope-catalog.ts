// @plantilla-quitar(ventas)
"use client";

import { useEffect, useState } from "react";
import { loadProductScopeCatalog } from "@/lib/actions/product-scope-catalog";
import type { ScopeCatalogProduct } from "@/lib/automations/product-scope";

/** Una sola lectura por pantalla: los paneles de Ventas y Servicios comparten el catálogo. */
let cache: Promise<ScopeCatalogProduct[] | null> | null = null;

/** El catálogo de productos y variantes. `undefined` mientras carga; `null` si no se pudo leer. */
export function useProductScopeCatalog(): ScopeCatalogProduct[] | null | undefined {
  const [catalog, setCatalog] = useState<ScopeCatalogProduct[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    cache ??= loadProductScopeCatalog().catch(() => null);
    cache.then((c) => {
      if (alive) setCatalog(c);
      if (c === null) cache = null;
    });
    return () => {
      alive = false;
    };
  }, []);
  return catalog;
}
