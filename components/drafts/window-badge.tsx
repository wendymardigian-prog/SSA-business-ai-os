import { cn } from "@/lib/utils";
import { formatRemaining, WINDOW_LEVEL_LABELS, type WindowInfo, type WindowLevel } from "@/lib/agent/drafts/window-state";

/**
 * El indicador de la ventana de mensajeria de un borrador (Bloque 2c). Cinco
 * estados; los cortes son fracciones de la ventana del canal (mitad, cuarto,
 * octavo), nunca horas fijas. Un canal sin ventana no muestra nada.
 *
 * Server-safe: sin hooks, lo usan la cola y la conversacion.
 */

const STYLES: Record<Exclude<WindowLevel, "none">, string> = {
  relaxed: "border-border bg-muted text-muted-foreground",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-200",
  urgent: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-200",
  last_call: "border-red-300 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  closed: "border-red-600 bg-red-600 text-white",
};

export function WindowBadge({ info, className }: { info: WindowInfo; className?: string }) {
  if (info.level === "none") return null;
  const remaining = formatRemaining(info);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", STYLES[info.level], className)}
      title={WINDOW_LEVEL_LABELS[info.level]}
    >
      {info.level === "last_call" && (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
        </span>
      )}
      <span>{info.level === "closed" ? "Ventana cerrada" : WINDOW_LEVEL_LABELS[info.level]}</span>
      {remaining && <span className="opacity-80">· {remaining}</span>}
    </span>
  );
}

const LEGEND: Array<{ level: Exclude<WindowLevel, "none">; text: string }> = [
  { level: "relaxed", text: "más de la mitad de la ventana" },
  { level: "warning", text: "menos de la mitad" },
  { level: "urgent", text: "menos de un cuarto" },
  { level: "last_call", text: "menos de un octavo" },
  { level: "closed", text: "ya no se puede enviar: responder a mano" },
];

/** Sin leyenda, tres amarillos distintos no significan nada. */
export function WindowLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Qué significa cada color">
      <span className="font-medium text-foreground">Ventana para responder:</span>
      {LEGEND.map((item) => (
        <span key={item.level} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full border", STYLES[item.level])} aria-hidden />
          <span>
            <span className="font-medium text-foreground">{WINDOW_LEVEL_LABELS[item.level]}</span>: {item.text}
          </span>
        </span>
      ))}
      <span>En Instagram la ventana es de 24 h desde el último mensaje del lead (12 h, 6 h y 3 h).</span>
    </div>
  );
}
