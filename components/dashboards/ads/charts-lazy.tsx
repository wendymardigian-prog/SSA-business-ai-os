"use client";

/**
 * Los graficos de anuncios, cargados a pedido.
 *
 * `ssr: false` y `next/dynamic`: recharts queda en un chunk aparte que solo
 * baja el navegador de quien abre un dashboard de anuncios. Ver el
 * comentario de `ads-charts.tsx` para el por que.
 */

import dynamic from "next/dynamic";
import { ChartSkeleton } from "./skeletons";

export const DailyEvolutionChart = dynamic(
  () => import("./ads-charts").then((m) => m.DailyEvolutionChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-full" /> },
);

export const StackedCampaignChart = dynamic(
  () => import("./ads-charts").then((m) => m.StackedCampaignChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);

export const AdComparisonChart = dynamic(
  () => import("./ads-charts").then((m) => m.AdComparisonChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-60" /> },
);

export const CostLinesChart = dynamic(
  () => import("./ads-charts").then((m) => m.CostLinesChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-56" /> },
);

export const AudienceStackChart = dynamic(
  () => import("./ads-charts").then((m) => m.AudienceStackChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-48" /> },
);

export const CtrByAgeChart = dynamic(
  () => import("./ads-charts").then((m) => m.CtrByAgeChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-40" /> },
);

export const GenderDonut = dynamic(
  () => import("./ads-charts").then((m) => m.GenderDonut),
  { ssr: false, loading: () => <ChartSkeleton height="h-44" /> },
);

export const HourlyChart = dynamic(
  () => import("./ads-charts").then((m) => m.HourlyChart),
  { ssr: false, loading: () => <ChartSkeleton height="h-44" /> },
);
