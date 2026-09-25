"use client";

import { cn } from "@/lib/utils";
import { useUrlFilters } from "@/components/agents/filters";

/** Equipo / míos para la franja de medición (solo Owner/Admin). */
export function MetricsScopeToggle({ onlyMine }: { onlyMine: boolean }) {
  const { setParam } = useUrlFilters();
  const option = (active: boolean, label: string, value: string) => (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setParam("metricas", value)}
      className={cn("rounded-md px-2 py-1 text-xs font-medium", active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Números de">
      {option(!onlyMine, "Equipo", "")}
      {option(onlyMine, "Míos", "mios")}
    </div>
  );
}
