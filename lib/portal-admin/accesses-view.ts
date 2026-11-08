// @plantilla-quitar(servicios)
/**
 * La pestaña Accesos de la ficha del servicio (F40), pura: una fila por acceso (con su estado, fechas y origen) y,
 * abajo, las secciones de la variante que todavía no se abrieron («Cuando el camino llegue a …»).
 */
import { SECTION_LABELS } from "@/lib/services/availability";
import { opensLabel } from "@/lib/services/screens/variant-portal-form";
import type { SectionRule } from "./settings";
import { ACCESS_STATE_LABELS, accessRowState, type AccessRowState } from "./access";
import type { AccessListRow } from "./load";

export const ACCESS_SOURCE_LABELS: Record<string, string> = {
  service_start: "Al empezar",
  journey_item: "Por el camino",
  automation: "Automatización o «Dar ahora»",
  manual_extra: "Acceso extra",
  renewal_transfer: "Pasó de la renovación",
  extension: "Extensión",
};

export interface AccessViewRow {
  id: string;
  section: string;
  sectionLabel: string;
  otherProgram: boolean;
  state: AccessRowState;
  stateLabel: string;
  from: string;
  until: string;
  sourceLabel: string;
  reason: string | null;
  canExtend: boolean;
  canRevoke: boolean;
}

const day = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }) : null;

export function accessViewRows(rows: AccessListRow[], productId: string, now: string, tz: string): AccessViewRow[] {
  return rows.map((r) => {
    const state = accessRowState({ ends_at: r.endsAt, revoked_at: r.revokedAt, suspended_overdue_at: r.suspendedOverdueAt, suspended_pause_at: r.suspendedPauseAt }, now);
    return {
      id: r.id,
      section: r.section,
      sectionLabel: SECTION_LABELS[r.section as keyof typeof SECTION_LABELS] ?? r.section,
      otherProgram: r.productId !== productId,
      state,
      stateLabel: state === "revoked" && r.revokeReason ? `${ACCESS_STATE_LABELS.revoked} (${revokeLabel(r.revokeReason)})` : ACCESS_STATE_LABELS[state],
      from: day(r.startsAt, tz) ?? "—",
      until: day(r.endsAt, tz) ?? (r.untilType === "phase_completed" || r.untilType === "item_completed" ? "Hasta que se complete el camino" : "Sin fecha"),
      sourceLabel: ACCESS_SOURCE_LABELS[r.source] ?? r.source,
      reason: r.reason,
      canExtend: state !== "revoked" && r.endsAt !== null,
      canRevoke: state !== "revoked",
    };
  });
}

export function revokeLabel(reason: string): string {
  switch (reason) {
    case "cancelled":
      return "servicio cancelado";
    case "refunded":
      return "reembolso";
    case "completed":
      return "servicio completado";
    case "renewed":
      return "renovado";
    case "until_reached":
      return "llegó a su fin";
    case "manual":
      return "a mano";
    default:
      return reason;
  }
}

/** Las secciones de la variante que todavía no tienen ninguna fila (ni vigente ni revocada). */
export function pendingSections(variantSections: SectionRule[], programOn: Partial<Record<string, boolean>>, rows: AccessListRow[], productId: string) {
  const opened = new Set(rows.filter((r) => r.productId === productId).map((r) => r.section));
  return variantSections
    .filter((s) => s.included !== false && programOn[s.section] !== false && !opened.has(s.section))
    .map((s) => ({ section: s.section, sectionLabel: SECTION_LABELS[s.section as keyof typeof SECTION_LABELS] ?? s.section, opensLabel: opensLabel(s) }));
}
