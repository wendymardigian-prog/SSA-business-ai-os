import Link from "next/link";
import { callBadgeClass, scoreBadgeTone } from "@/lib/calls/badges";
import { formatCallDate, humanize } from "@/lib/calls/format";
import { callTypeLabel } from "@/lib/calls/list";
import type { CallSectionRow } from "@/lib/calls/contact-section";

/**
 * La lista de llamadas que se muestra en la ficha del contacto y en el detalle
 * de la agenda (F34): fecha, tipo, closer, resultado y puntajes, con un link a
 * la ficha de la llamada. Es un componente de presentacion (sin estado): quien
 * lo usa decide cuales llamadas mostrar y si la persona tiene `calls.view`.
 */
export function CallSectionList({ rows, timeZone, compact = false }: { rows: CallSectionRow[]; timeZone: string; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/dashboard/llamadas/${c.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-sm hover:bg-muted/60">
            <span className="tabular-nums">{formatCallDate(c.recordedAt, timeZone, "short")}</span>
            <span className="text-muted-foreground">·</span>
            <span>{callTypeLabel(c.callType)}</span>
            {c.closerName && <span className="text-xs text-muted-foreground">con {c.closerName}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {c.status !== "analyzed" ? (
                <span className="text-xs text-muted-foreground">{statusText(c.status)}</span>
              ) : (
                <>
                  {c.outcome && <span className={callBadgeClass("info")}>{humanize(c.outcome)}</span>}
                  {!compact && c.closerScore !== null && (
                    <span className={callBadgeClass(scoreBadgeTone(c.closerScore))} title="Puntaje del closer">Closer {c.closerScore}</span>
                  )}
                  {!compact && c.leadScore !== null && (
                    <span className={callBadgeClass(scoreBadgeTone(c.leadScore))} title="Puntaje del lead">Lead {c.leadScore}</span>
                  )}
                </>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<string, string> = {
  classifying: "Clasificando…",
  needs_review: "Por revisar",
  pending: "Sin analizar",
  analyzing: "Analizando…",
  not_applicable: "No se analiza",
  error: "Con error",
};
const statusText = (s: string) => STATUS_TEXT[s] ?? "Sin analizar";
