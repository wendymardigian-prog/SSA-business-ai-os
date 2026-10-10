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
