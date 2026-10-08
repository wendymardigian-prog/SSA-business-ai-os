"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { parsePeriodFilter, periodFilterToParams } from "@/lib/agent/ai-dashboard/url-state";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";

/**
 * El filtro de período del mini dashboard de IA (A2), en el `filters` de
 * `PageHeader`.
 *
 * Reusa `PeriodPopover` tal cual: no se toca, se consume. Lo propio aca es
 * leer y escribir `?range=&from=&to=` en la URL (lib/agent/ai-dashboard/url-state.ts).
 *
 * Con `useTransition`, cambiar el período no muestra el esqueleto de carga de
 * vuelta: el panel sigue mostrando los datos viejos (atomicamente, cards y
 * gráfico juntos) hasta que llegan los nuevos.
 */
export function AiPeriodControl({ timezone }: { timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filter = parsePeriodFilter(searchParams);

  function onApply(next: { preset: PeriodPreset | null; from: string | null; to: string | null }) {
    const merged = { period: next.preset ?? filter.period, from: next.from, to: next.to };
    const params = periodFilterToParams(merged);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex items-center gap-2">
      <PeriodPopover preset={filter.period} presets={PERIOD_PRESETS} labels={PERIOD_LABELS} from={filter.from} to={filter.to} timezone={timezone} onApply={onApply} />
      {pending && (
        <span className="text-xs text-muted-foreground" role="status">
          Actualizando…
        </span>
      )}
    </div>
  );
}
