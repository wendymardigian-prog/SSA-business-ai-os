import { Upload, Video, AlertTriangle, Loader2 } from "lucide-react";
import {
  analysisBadgeTone, callBadgeClass, outcomeBadgeTone, qualificationBadgeTone, scoreBadgeTone, scoreBarClass, typeBadgeTone,
} from "@/lib/calls/badges";
import { callTypeLabel } from "@/lib/calls/list";
import { humanize } from "@/lib/calls/format";
import { statusLabel } from "@/lib/calls/status";

/**
 * Los chips de Llamadas. TODOS salen del mismo mapa de colores
 * (`lib/calls/badges.ts`): aca solo se dibujan.
 */

export function TypeChip({ type, needsReview, custom }: { type: string | null; needsReview?: boolean; custom?: Array<{ clave: string; nombre: string }> }) {
  if (needsReview) {
    return <span className={callBadgeClass("review")}>Por revisar</span>;
  }
  return <span className={callBadgeClass(typeBadgeTone(type))}>{callTypeLabel(type, custom)}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const busy = status === "analyzing" || status === "classifying";
  return (
    <span className={`${callBadgeClass(analysisBadgeTone(status))} gap-1`}>
      {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {statusLabel(status)}
    </span>
  );
}

export function OutcomeChip({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-muted-foreground">—</span>;
  return <span className={callBadgeClass(outcomeBadgeTone(outcome))}>{humanize(outcome)}</span>;
}

export function QualificationChip({ value }: { value: string | null }) {
  if (!value) return null;
  return <span className={callBadgeClass(qualificationBadgeTone(value))}>{humanize(value)}</span>;
}

export function SourceChip({ source }: { source: string }) {
  return source === "manual" ? (
    <span className={`${callBadgeClass("classification")} gap-1`}><Upload className="h-3 w-3" aria-hidden /> Importada</span>
  ) : (
    <span className={`${callBadgeClass("neutral")} gap-1`}><Video className="h-3 w-3" aria-hidden /> Fathom</span>
  );
}

export function AlertsChip({ open }: { open: boolean }) {
  if (!open) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`${callBadgeClass("negative")} gap-1`} title="Tiene alertas sin revisar">
      <AlertTriangle className="h-3 w-3" aria-hidden />
      <span className="sr-only">Tiene alertas sin revisar</span>
    </span>
  );
}

/** Numero + barra, con el mismo color que el chip. */
export function ScoreCell({ score, label }: { score: number | null; label?: string }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>;
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return (
    <div className="flex items-center gap-2" title={label ? `${label}: ${value}` : undefined}>
      <span className={`${callBadgeClass(scoreBadgeTone(value))} tabular-nums`}>{value}</span>
      <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <div className={`h-full ${scoreBarClass(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
