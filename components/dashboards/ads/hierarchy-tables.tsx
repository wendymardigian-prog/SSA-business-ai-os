"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import type { AdsRow, AdsTotalsWithSource } from "@/lib/dashboards/ads";
import type { ParentScope } from "@/lib/dashboards/ads-crm";
import { periodQuery, type PeriodFilter } from "@/lib/dashboards/period-filter";
import { CrmLevelTable } from "./crm-table";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";

/**
 * El desglose jerarquico del dashboard de Meta Ads y de los detalles: campañas, conjuntos y anuncios en la tabla «Meta vs CRM»,
 * con sus columnas elegibles. Un clic en una fila lleva al detalle de ese objeto.
 *
 * La pantalla Anuncios no usa esto: lleva las pestañas y los filtros a la barra superior (`ads-table-page.tsx`).
 */

export type Level = "campaign" | "adset" | "ad";

export const TAB_LABEL: Record<Level, string> = { campaign: "Campañas", adset: "AdSets", ad: "Anuncios" };
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
}: {
  /** Los niveles que se muestran, en orden. La primera pestaña es la inicial. */
  levels: Level[];
  /** Las filas a agrupar: las del periodo, ya filtradas al objeto si es un detalle. */
  rows: AdsRow[];
  totals: AdsTotalsWithSource;
  currency: string | null;
  adAccountId: string;
  period: PeriodFilter;
  heading?: ReactNode;
  crm: CrmTableData;
  /** En un detalle: mostrar solo los hijos de este objeto. */
  scope?: ParentScope | null;
}) {
  const [level, setLevel] = useState<Level>(levels[0]);

  return (
    <section className="space-y-2" aria-label="Desglose jerárquico">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{heading}</p>
      <div className="rounded-xl border border-border bg-card p-4">
        <Tabs label="Nivel del desglose" value={level} onChange={(next: Level) => setLevel(next)} tabs={levels.map((l) => ({ value: l, label: TAB_LABEL[l] }))}>
          <CrmLevelTable
            level={level}
            rows={rows}
            totals={totals}
            crm={crm}
            currency={currency}
            hrefOf={(id) => detailHref(level, id, adAccountId, period)}
            scope={scope}
          />
        </Tabs>
      </div>
    </section>
  );
}
