import type { CapStatus } from "@/lib/ai-tasks/limits";
import { formatSpend } from "@/lib/background/screen";

const TONE = {
  green: "bg-good/10 text-good",
  yellow: "bg-yellow-400/15 text-yellow-800 dark:text-yellow-300",
  red: "bg-bad/10 text-bad",
} as const;

/** El gasto del mes frente al tope de una tarea: verde, amarillo desde el 80 % y rojo al llegar. */
export function CapPill({ status }: { status: CapStatus }) {
  if (status.capUsd === null) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Sin tope</span>;
  if (status.light === null || status.pct === null)
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Tope {formatSpend(status.capUsd)} · gasto sin dato</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status.light]}`}>
      {status.pct.toLocaleString("es-AR")} % de {formatSpend(status.capUsd)}
    </span>
  );
}
