"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";

/**
 * El periodo y el closer del dashboard de Llamadas, en la barra superior. El
 * periodo reusa `PeriodPopover` (mismos parametros `range`, `from` y `to` que el
 * resto de los dashboards). Cambiar uno conserva lo demas de la URL.
 */
export function CallsControls({ timezone, closers }: { timezone: string; closers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filter = parsePeriodFilter(searchParams);
  const closer = searchParams.get("closer") ?? "";

  function replace(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function onApply(next: { preset: PeriodPreset | null; from: string | null; to: string | null }) {
    replace((p) => {
      p.delete("range");
      p.delete("from");
      p.delete("to");
      if (next.from && next.to) {
        p.set("from", next.from);
        p.set("to", next.to);
      } else if (next.preset) {
        p.set("range", next.preset);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {closers.length > 0 && (
        <select
          aria-label="Closer"
          value={closer}
          onChange={(e) => replace((p) => (e.target.value ? p.set("closer", e.target.value) : p.delete("closer")))}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="">Todo el equipo</option>
          {closers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <PeriodPopover preset={filter.period} presets={PERIOD_PRESETS} labels={PERIOD_LABELS} from={filter.from} to={filter.to} timezone={timezone} allowFuture={false} onApply={onApply} />
      {pending && (
        <span className="text-xs text-muted-foreground" role="status">
          Actualizando…
        </span>
      )}
    </div>
  );
}
