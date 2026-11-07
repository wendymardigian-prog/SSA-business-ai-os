"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import type { AdsRow, AdsTotals } from "@/lib/dashboards/ads";
import type { CrmRow, ParentScope } from "@/lib/dashboards/ads-crm";
import { drillChips, drillScope, drillTargets, drillToParams, parseDrill, withLevel, type DrillState } from "@/lib/dashboards/ads-drill";
import { periodQuery, type PeriodFilter } from "@/lib/dashboards/period-filter";
import { CrmLevelTable } from "./crm-table";
import type { RowAction } from "./row-actions-menu";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";

/**
 * El desglose jerarquico: campañas, conjuntos y anuncios en la tabla «Meta vs CRM», con sus columnas elegibles.
 *
 * Dos formas de moverse:
 *  - Por defecto (dashboard y detalles), un clic en una fila lleva al detalle de ese objeto.
 *  - Con `drill` (pantalla Anuncios), un clic abre un menu para ver los hijos ahi mismo, sin salir de la pantalla. Lo elegido
 *    vive en la URL (`lib/dashboards/ads-drill.ts`), asi el «atras» del navegador lo deshace.
 */

export type Level = "campaign" | "adset" | "ad";

const TAB_LABEL: Record<Level, string> = { campaign: "Campañas", adset: "AdSets", ad: "Anuncios" };
const SEGMENT: Record<Level, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };

export function detailHref(level: Level, objectId: string, adAccountId: string, period: PeriodFilter): string {
  return `/dashboard/dashboards/ads/${SEGMENT[level]}/${objectId}?${periodQuery(period, { cuenta: adAccountId })}`;
}

export function HierarchyCard({
  levels,
  rows,
  totals,
  currency,
  adAccountId,
  period,
  heading = "Desglose jerárquico",
  crm,
  scope = null,
  drill = false,
}: {
  /** Los niveles que se muestran, en orden. La primera pestaña es la inicial. */
  levels: Level[];
  /** Las filas a agrupar: las del periodo, ya filtradas al objeto si es un detalle. */
  rows: AdsRow[];
  totals: AdsTotals;
  currency: string | null;
  adAccountId: string;
  period: PeriodFilter;
  heading?: ReactNode;
  crm: CrmTableData;
  /** En un detalle: mostrar solo los hijos de este objeto. */
  scope?: ParentScope | null;
  /** Pantalla Anuncios: un clic en una fila ofrece ver sus hijos ahi mismo. */
  drill?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localLevel, setLocalLevel] = useState<Level>(levels[0]);

  const urlLevel = drill ? parseDrill(searchParams).level : null;
  const urlCampaign = drill ? parseDrill(searchParams).campaignId : null;
  const urlAdset = drill ? parseDrill(searchParams).adsetId : null;
  const state = useMemo<DrillState | null>(() => (urlLevel ? { level: urlLevel, campaignId: urlCampaign, adsetId: urlAdset } : null), [urlLevel, urlCampaign, urlAdset]);
  const level = state?.level ?? localLevel;
  const activeScope = useMemo(() => (state ? drillScope(state) : scope), [state, scope]);

  // Sin pedirle la pagina al servidor: los datos de los tres niveles ya estan aca.
  const goTo = useCallback(
    (next: DrillState) => {
      const query = drillToParams(new URLSearchParams(searchParams.toString()), next).toString();
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname, searchParams],
  );

  const rowActions = useCallback(
    (row: CrmRow): RowAction[] =>
      drillTargets(level, row).map((target) =>
        target.kind === "drill"
          ? { label: target.label, onSelect: () => goTo(target.state) }
          : { label: target.label, href: detailHref(level, row.objectId, adAccountId, period) },
      ),
    [level, goTo, adAccountId, period],
  );

  const chips = state
    ? drillChips(state, (parent, id) => rows.find((r) => r.level === parent && r.objectId === id)?.objectName ?? crm.catalog[parent][id]?.name ?? null)
    : [];

  return (
    <section className="space-y-2" aria-label="Desglose jerárquico">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{heading}</p>
      <div className="rounded-xl border border-border bg-card p-4">
        <Tabs
          label="Nivel del desglose"
          value={level}
          onChange={(next: Level) => (state ? goTo(withLevel(state, next)) : setLocalLevel(next))}
          tabs={levels.map((l) => ({ value: l, label: TAB_LABEL[l] }))}
        >
          {chips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Mostrando solo:</span>
              {chips.map((chip) => (
                <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1">
                  <span className="truncate">
                    <span className="text-muted-foreground">{chip.label}:</span> {chip.name ?? "sin nombre"}
                  </span>
                  <button
                    type="button"
                    onClick={() => goTo(chip.clear)}
                    aria-label={`Sacar el filtro de ${chip.label}`}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          <CrmLevelTable
            level={level}
            rows={rows}
            totals={totals}
            crm={crm}
            currency={currency}
            hrefOf={(id) => detailHref(level, id, adAccountId, period)}
            scope={activeScope}
            rowActions={drill ? rowActions : undefined}
          />
        </Tabs>
      </div>
    </section>
  );
}
