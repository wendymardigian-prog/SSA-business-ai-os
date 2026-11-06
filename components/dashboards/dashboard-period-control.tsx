"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { PERIOD_LABELS, PERIOD_PRESETS } from "@/lib/dashboards/period";
import { applyPeriodToParams, type PeriodFilter, type PeriodSelection } from "@/lib/dashboards/period-filter";
import { PeriodPopover } from "./chat/filters/period-popover";

/**
 * El selector de fechas de un dashboard: los atajos de siempre y el calendario, en la zona de quien mira.
 * Sin `onApply`, escribe lo elegido en la URL; una pantalla que atenua su contenido mientras carga pasa el suyo.
 */
export function DashboardPeriodControl({ period, onApply }: { period: PeriodFilter; onApply?: (selection: PeriodSelection) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timezone = useViewerTimezone();
  const [pending, startTransition] = useTransition();

  function applyToUrl(selection: PeriodSelection) {
    const query = applyPeriodToParams(new URLSearchParams(searchParams.toString()), selection).toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div className={pending ? "opacity-60" : undefined} aria-busy={pending}>
      <PeriodPopover
        preset={period.period}
        presets={PERIOD_PRESETS}
        labels={PERIOD_LABELS}
        from={period.from}
        to={period.to}
        timezone={timezone}
        allowFuture={false}
        onApply={onApply ?? applyToUrl}
      />
    </div>
  );
}
