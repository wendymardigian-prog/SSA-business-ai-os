"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { CrmLevel } from "@/lib/dashboards/ads-crm";
import { levelToParams, parseLevel } from "@/lib/dashboards/ads-drill";
import { adsTableFiltersToParams, parseAdsTableFilters, type AdsTableFilters } from "@/lib/dashboards/ads-table-filters";

/**
 * La pestaña y los filtros de la pantalla Anuncios, en la URL (`ads-drill.ts` y `ads-table-filters.ts`).
 *
 * Se escriben con `window.history.pushState`, sin pedirle la pagina al servidor: los datos de los tres niveles ya estan en el
 * navegador. Next sincroniza `useSearchParams` con eso, y el «atras» deshace el ultimo cambio.
 */
export function useAdsTableUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  const level = parseLevel(searchParams);
  const filters = useMemo(() => parseAdsTableFilters(new URLSearchParams(query)), [query]);

  const push = useCallback(
    (params: URLSearchParams) => {
      const next = params.toString();
      if (next === query) return;
      window.history.pushState(null, "", next ? `${pathname}?${next}` : pathname);
    },
    [pathname, query],
  );

  const setFilters = useCallback((next: AdsTableFilters) => push(adsTableFiltersToParams(new URLSearchParams(query), next)), [push, query]);
  const setLevel = useCallback((next: CrmLevel) => push(levelToParams(new URLSearchParams(query), next)), [push, query]);
  /** «Ver AdSets» / «Ver anuncios» del menu de una fila: otra pestaña, filtrada por su padre. */
  const drillTo = useCallback(
    (next: CrmLevel, campaignIds: string[], adsetIds: string[]) =>
      push(levelToParams(adsTableFiltersToParams(new URLSearchParams(query), { ...filters, campaignIds, adsetIds }), next)),
    [push, query, filters],
  );

  return { level, filters, setFilters, setLevel, drillTo };
}
