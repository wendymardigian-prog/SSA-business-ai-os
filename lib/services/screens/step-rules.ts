// @plantilla-quitar(servicios)
/**
 * El estado y los cambios de «Se puede completar desde», «Pide evidencia» y el checklist de un paso en el editor del
 * camino (Servicios A4, F146 a F148). PURO: el drawer solo compone. Todo vive dentro de `ref` (como el botón de A2).
 */
import { CHECKLIST_KINDS, CHECKLIST_MAX_ITEMS, EVIDENCE_KINDS } from "@/lib/services/journey-template";
import type { ItemKind } from "@/lib/services/availability";
import type { EvidenceKind } from "@/lib/services/evidence";

export type LockMode = "any" | "days" | "after";
export type LockForm = { mode: LockMode; from: "service_created" | "service_start" | "phase_start"; days: number; afterKey: string };

export const LOCK_FROM_LABEL: Record<LockForm["from"], string> = {
  service_created: "la creación del servicio",
  service_start: "el inicio del servicio",
  phase_start: "el inicio de la fase",
};

export function lockForm(ref: Record<string, unknown>): LockForm {
  const l = ref.lock as Record<string, unknown> | undefined;
  if (l && typeof l.after_item_key === "string") return { mode: "after", from: "phase_start", days: 0, afterKey: l.after_item_key };
  if (l && typeof l.from === "string" && ["service_created", "service_start", "phase_start"].includes(l.from)) {
    return { mode: "days", from: l.from as LockForm["from"], days: Number(l.days) || 0, afterKey: "" };
  }
  return { mode: "any", from: "phase_start", days: 0, afterKey: "" };
}

/** El `ref` nuevo con el bloqueo elegido (o sin él). */
export function withLock(ref: Record<string, unknown>, f: LockForm): Record<string, unknown> {
  const next = { ...ref };
  if (f.mode === "any") delete next.lock;
  else if (f.mode === "after") next.lock = { after_item_key: f.afterKey };
  else next.lock = { from: f.from, days: Math.max(0, Math.min(365, Math.round(f.days))) };
  return next;
}

export function canAskEvidence(kind: ItemKind): boolean {
  return EVIDENCE_KINDS.includes(kind);
}
export function canHaveChecklist(kind: ItemKind): boolean {
  return CHECKLIST_KINDS.includes(kind);
}

export function evidenceForm(ref: Record<string, unknown>): { required: boolean; kinds: EvidenceKind[] } {
  const e = ref.evidence as { required?: unknown; kinds?: unknown } | undefined;
  const kinds = Array.isArray(e?.kinds) ? (e!.kinds as unknown[]).filter((k): k is EvidenceKind => k === "file" || k === "link" || k === "note") : [];
  return { required: e?.required === true, kinds };
}

export function withEvidence(ref: Record<string, unknown>, required: boolean, kinds: EvidenceKind[]): Record<string, unknown> {
  const next = { ...ref };
  if (!required) delete next.evidence;
  else next.evidence = { required: true, kinds: kinds.length ? [...new Set(kinds)] : ["file", "link", "note"] };
  return next;
}

export function checklistForm(ref: Record<string, unknown>): string[] {
  return Array.isArray(ref.checklist) ? (ref.checklist as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

/** El `ref` con el checklist (sin puntos vacíos; vacío = sin checklist). */
export function withChecklist(ref: Record<string, unknown>, points: string[]): Record<string, unknown> {
  const next = { ...ref };
  const clean = points.map((p) => p.trim()).filter(Boolean).slice(0, CHECKLIST_MAX_ITEMS);
  if (clean.length === 0) delete next.checklist;
  else next.checklist = clean;
  return next;
}
