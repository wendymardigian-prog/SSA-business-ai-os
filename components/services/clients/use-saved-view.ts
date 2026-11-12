// @plantilla-quitar(servicios)
"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardChrome } from "@/components/dashboard-chrome";
import { applySavedView, savedViewKey, viewFromParams } from "@/lib/services/screens/saved-view";

/**
 * La vista guardada de una pestaña de Clientes: al entrar sin vista en la URL se aplica la guardada; `save()` guarda la
 * de ahora. `localStorage` siempre en `try/catch` (sin el, la vista de siempre).
 */
export function useSavedView(table: "servicios" | "clientes") {
  const chrome = useDashboardChrome();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const userId = chrome?.user.id ?? "anon";
  const qs = params?.toString() ?? "";

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(savedViewKey(table, userId));
    } catch {
      saved = null;
    }
    const next = applySavedView(pathname, qs, saved);
    if (next) router.replace(next, { scroll: false });
    // Solo al entrar: despues, la URL manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useCallback(() => {
    try {
      window.localStorage.setItem(savedViewKey(table, userId), viewFromParams(qs));
      return true;
    } catch {
      return false;
    }
  }, [table, userId, qs]);
}
