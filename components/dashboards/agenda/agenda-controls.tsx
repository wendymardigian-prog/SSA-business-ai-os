"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { AGENDA_AXES, parseAxis } from "@/lib/dashboards/agenda";

/**
 * El periodo y el eje del dashboard de Agenda, en la barra superior.
 *
 * El periodo reusa `PeriodPopover` tal cual (mismos parametros `range`, `from`
 * y `to` que el dashboard de Chat). Lo propio es el eje: cuenta las agendas
 * por el dia en que se pidieron (lo que sirve para medir de donde vienen) o
 * por el dia de la reunion.
 *
 * Cambiar uno conserva lo demas de la URL (`ver`, el eje): por eso arma los
 * parametros sobre los actuales en vez de partir de cero.
 */
export function AgendaControls({ timezone }: { timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const filter = parsePeriodFilter(searchParams);
  const axis = parseAxis(searchParams.get("eje"));

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
      <select
        aria-label="Contar las agendas por"
        value={axis}
        onChange={(e) => replace((p) => (e.target.value === "created" ? p.delete("eje") : p.set("eje", e.target.value)))}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        {AGENDA_AXES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <PeriodPopover
        preset={filter.period}
        presets={PERIOD_PRESETS}
        labels={PERIOD_LABELS}
        from={filter.from}
        to={filter.to}
        timezone={timezone}
        allowFuture={axis === "start"}
        onApply={onApply}
      />
      {pending && (
        <span className="text-xs text-muted-foreground" role="status">
          Actualizando…
        </span>
      )}
    </div>
  );
}
