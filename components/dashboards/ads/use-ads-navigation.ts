"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { applyPeriodToParams, type PeriodSelection } from "@/lib/dashboards/period-filter";

/**
 * Cambiar el periodo o la cuenta y actualizar, en el dashboard y en los
 * detalles. La cuenta y el periodo viajan en la URL; `pending` es true
 * mientras el servidor arma la pagina nueva, para apagar un poco la pantalla
 * y girar el icono de Actualizar.
 */
export function useAdsNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(params: { cuenta?: string }) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
    // Otra cuenta tiene otras campañas: un filtro de la anterior dejaria la tabla vacia.
    if (params.cuenta) for (const key of ["campana", "conjunto"]) next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function applyPeriod(selection: PeriodSelection) {
    const query = applyPeriodToParams(new URLSearchParams(searchParams.toString()), selection).toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  return { pending, navigate, applyPeriod, refresh };
}
