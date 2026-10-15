"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { PERIOD_LABELS, PERIOD_PRESETS, isPeriodPreset, type PeriodPreset } from "@/lib/dashboards/period";

/**
 * El período del Resumen de Finanzas. Mismo selector que los dashboards (`PeriodPopover`, mismos parámetros
 * `range`, `from` y `to`), pero el que arranca elegido es «Este mes» y no 30 días. Cortar los días con la zona
 * del WORKSPACE (la contabilidad no cambia según quién mira): se muestra a la vista.
 */
const DEFAULT: PeriodPreset = "este-mes";

export function FinancePeriodControls({ timezone }: { timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const range = searchParams.get("range");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const custom = !!from && !!to;
  const preset: PeriodPreset = range && isPeriodPreset(range) ? range : DEFAULT;

  function onApply(next: { preset: PeriodPreset | null; from: string | null; to: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.delete("from");
    params.delete("to");
    if (next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    } else if (next.preset && next.preset !== DEFAULT) {
      params.set("range", next.preset);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground lg:inline" title="Los días se cortan en la zona horaria del negocio">
        {timezone}
      </span>
      <PeriodPopover preset={preset} presets={PERIOD_PRESETS} labels={PERIOD_LABELS} from={custom ? from : null} to={custom ? to : null} timezone={timezone} onApply={onApply} />
      {pending && (
        <span className="text-xs text-muted-foreground" role="status">
          Actualizando…
        </span>
      )}
    </div>
  );
}
