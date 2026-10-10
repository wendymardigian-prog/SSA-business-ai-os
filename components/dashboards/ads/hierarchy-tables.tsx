"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart2 } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import {
  count,
  ctrTone,
  groupByObject,
  leadsTone,
  money,
  percent,
  statusLabel,
  type AdsRow,
  type AdsTotals,
  type GroupedRow,
} from "@/lib/dashboards/ads";
import { latestRankings, rankingTone, type Rankings } from "@/lib/dashboards/ads-view";
import type { PeriodPreset } from "@/lib/dashboards/period";
import { COL_TIPS, COL_TIPS_ADS, type ColTip } from "./col-tips";

/**
 * El desglose jerarquico: campañas, conjuntos y anuncios, cada uno con las
 * columnas de la referencia, los encabezados que explican que es cada cifra,
 * el estado, los rankings y una fila de total.
 *
 * Un clic en una fila lleva al detalle de ese objeto.
 */

export type Level = "campaign" | "adset" | "ad";

export interface UniqueReach {
  campaign: Record<string, number> | null;
  adset: Record<string, number> | null;
  ad: Record<string, number> | null;
}

const TAB_LABEL: Record<Level, string> = { campaign: "Campañas", adset: "AdSets", ad: "Anuncios" };
const EMPTY_LABEL: Record<Level, string> = {
  campaign: "Sin campañas en este período",
  adset: "Sin ad sets en este período",
  ad: "Sin anuncios en este período",
};

const SEGMENT: Record<Level, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };

export function detailHref(level: Level, objectId: string, adAccountId: string, period: PeriodPreset): string {
  return `/dashboard/dashboards/ads/${SEGMENT[level]}/${objectId}?cuenta=${adAccountId}&periodo=${period}`;
}

const CTR_CLASS = { good: "text-green-600", bad: "text-destructive", neutral: "text-foreground" } as const;

const TD = "px-2 py-2";
const TD_NUM = `${TD} text-right text-foreground`;

// ── Piezas chicas ────────────────────────────────────────────────────────

function TipTh({ label, align, tips }: { label: string; align: "left" | "right"; tips: Record<string, ColTip> }) {
  const tip = tips[label];
  const base = `px-2 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground ${align === "right" ? "text-right" : "text-left"}`;
  if (!tip) {
    return (
      <th scope="col" className={base}>
        {label}
      </th>
    );
  }
  return (
    <th scope="col" className={base}>
      <Tip
        align={align === "right" ? "center" : "start"}
        content={
          <>
            <p className="mb-1 font-semibold text-foreground">{tip.title}</p>
            <p className="text-muted-foreground">{tip.body}</p>
          </>
        }
      >
        <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {label}
        </span>
      </Tip>
    </th>
  );
}

export function StatusDot({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const active = status === "ACTIVE";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-muted-foreground"}`} aria-hidden />
      <span className={active ? "text-green-600" : "text-muted-foreground"}>{active ? "Activa" : status === "PAUSED" ? "Pausada" : statusLabel(status)}</span>
    </span>
  );
}

const RANKING_BADGE = {
  above: { text: "▲ Superior", cls: "bg-emerald-500/15 text-emerald-600" },
  average: { text: "— Promedio", cls: "bg-yellow-500/15 text-yellow-600" },
  below: { text: "▼ Inferior", cls: "bg-red-500/15 text-red-500" },
} as const;

export function RankingBadge({ value }: { value: string | null }) {
  const tone = rankingTone(value);
  if (!tone) return <span className="text-muted-foreground">—</span>;
  const badge = RANKING_BADGE[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span>;
}

function Leads({ value }: { value: number | null }) {
  return (
    <span className={leadsTone(value) === "bad" ? "font-bold text-destructive" : "font-semibold text-foreground"}>
      {count(value)}
    </span>
  );
}

// ── La tabla de un nivel ─────────────────────────────────────────────────

const HEADERS: Record<Level, string[]> = {
  campaign: ["Campaña", "Estado", "Gasto", "Impr.", "Alcance", "Frec.", "Clics", "CTR", "CPM", "CPC", "Leads", "CPL", "Conv."],
  adset: ["Ad Set", "Estado", "Gasto", "Impr.", "Alcance", "Frec.", "Clics", "CTR", "CPM", "CPC", "Leads", "CPL"],
  ad: ["Anuncio", "Gasto", "Impr.", "Clics", "CTR", "CPC", "Leads", "Calidad", "Eng.", "Conv."],
};

function LevelTable({
  level,
  groups,
  totals,
  rankings,
  currency,
  hrefOf,
}: {
  level: Level;
  groups: GroupedRow[];
  totals: AdsTotals;
  rankings: Record<string, Rankings>;
  currency: string | null;
  hrefOf: (objectId: string) => string;
}) {
  const router = useRouter();
  const m = (value: number | null) => money(value, currency, { narrow: true });
  const headers = HEADERS[level];
  const tips = level === "ad" ? COL_TIPS_ADS : COL_TIPS;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
        <BarChart2 className="h-8 w-8 opacity-40" aria-hidden /> {EMPTY_LABEL[level]}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <TipTh key={h} label={h} align={(level === "ad" ? i === 0 : i < 2) ? "left" : "right"} tips={tips} />
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const rank = rankings[g.objectId];
            return (
              <tr
                key={g.objectId}
                onClick={() => router.push(hrefOf(g.objectId))}
                className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
              >
                <td className={`${TD} max-w-[200px] truncate font-medium text-foreground`} title={g.objectName ?? g.objectId}>
                  <Link href={hrefOf(g.objectId)} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {g.objectName || g.objectId}
                  </Link>
                </td>
                {level !== "ad" && (
                  <td className={`${TD} text-xs`}>
                    <StatusDot status={g.status} />
                  </td>
                )}
                <td className={TD_NUM}>{m(g.spend)}</td>
                <td className={TD_NUM}>{count(g.impressions)}</td>
                {level !== "ad" && <td className={TD_NUM}>{count(g.reach)}</td>}
                {level !== "ad" && <td className={TD_NUM}>{g.frequency?.toFixed(2) ?? "—"}</td>}
                <td className={TD_NUM}>{count(g.clicks)}</td>
                <td className={`${TD} text-right ${CTR_CLASS[ctrTone(g.ctr)]}`}>{percent(g.ctr)}</td>
                {level !== "ad" && <td className={TD_NUM}>{m(g.cpm)}</td>}
                <td className={TD_NUM}>{m(g.cpc)}</td>
                <td className={`${TD} text-right`}>
                  <Leads value={g.leads} />
                </td>
                {level !== "ad" && <td className={TD_NUM}>{m(g.cpl)}</td>}
                {level === "campaign" && <td className={TD_NUM}>{count(g.purchases)}</td>}
                {level === "ad" && (
                  <>
                    <td className={`${TD} text-right`}><RankingBadge value={rank?.quality ?? null} /></td>
                    <td className={`${TD} text-right`}><RankingBadge value={rank?.engagement ?? null} /></td>
                    <td className={`${TD} text-right`}><RankingBadge value={rank?.conversion ?? null} /></td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className={`${TD} text-foreground`}>Total</td>
            {level !== "ad" && <td className={TD} />}
            <td className={`${TD} text-right text-primary`}>{m(totals.spend)}</td>
            <td className={TD_NUM}>{count(totals.impressions)}</td>
            {level !== "ad" && <td className={TD_NUM}>{count(totals.reach)}</td>}
            {level !== "ad" && <td className={TD_NUM}>{totals.frequency?.toFixed(2) ?? "—"}</td>}
            <td className={TD_NUM}>{count(totals.clicks)}</td>
            <td className={TD_NUM}>{percent(totals.ctr)}</td>
            {level !== "ad" && <td className={TD_NUM}>{m(totals.cpm)}</td>}
            <td className={TD_NUM}>{m(totals.cpc)}</td>
            <td className={TD_NUM}>{count(totals.leads)}</td>
            {level !== "ad" && <td className={TD_NUM}>{m(totals.cpl)}</td>}
            {level === "campaign" && <td className={TD_NUM}>{count(totals.purchases)}</td>}
            {level === "ad" && <td className={TD} colSpan={3} />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── La tarjeta con sus pestañas ──────────────────────────────────────────

export function HierarchyCard({
  levels,
  rows,
  totals,
  uniqueReach,
  currency,
  adAccountId,
  period,
  heading = "Desglose jerárquico",
}: {
  /** Los niveles que se muestran, en orden. La primera pestaña es la inicial. */
  levels: Level[];
  /** Las filas a agrupar: las del periodo, ya filtradas al objeto si es un detalle. */
  rows: AdsRow[];
  totals: AdsTotals;
  uniqueReach: UniqueReach;
  currency: string | null;
  adAccountId: string;
  period: PeriodPreset;
  heading?: ReactNode;
}) {
  const [level, setLevel] = useState<Level>(levels[0]);
  const groups = groupByObject(rows, level, uniqueReach[level]);
  const rankings = level === "ad" ? latestRankings(rows) : {};

  return (
    <section className="space-y-2" aria-label="Desglose jerárquico">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{heading}</p>
      <div className="rounded-xl border border-border bg-card p-4">
        <Tabs
          label="Nivel del desglose"
          value={level}
          onChange={setLevel}
          tabs={levels.map((l) => ({ value: l, label: TAB_LABEL[l] }))}
        >
          <LevelTable
            level={level}
            groups={groups}
            totals={totals}
            rankings={rankings}
            currency={currency}
            hrefOf={(id) => detailHref(level, id, adAccountId, period)}
          />
        </Tabs>
      </div>
    </section>
  );
}
