// @plantilla-quitar(servicios)
/**
 * El candado y la evidencia de cada paso en la ficha del servicio (Servicios A4, F146 y F147). PURO: usa la misma
 * regla que la base (`lockPlan`, gemela de `svc_lock_plan`) para mostrar; quien decide al completar es la base.
 */
import { lockPlan, type LockState } from "../lock";
import { evidenceMissing, readEvidence, readEvidenceRule, type EvidenceEntry, type EvidenceRule } from "../evidence";

export interface StepRuleItem {
  id: string;
  phase_id: string;
  template_key: string | null;
  status: string;
  ref: Record<string, unknown> | null;
  evidence: unknown;
}

export interface StepRuleView {
  lock: LockState;
  evidenceRule: EvidenceRule | null;
  evidence: EvidenceEntry[];
  evidenceMissing: boolean;
}

export function recordStepRules(
  items: StepRuleItem[],
  phases: Array<{ id: string; started_at: string | null }>,
  service: { created_at: string; starts_on: string | null },
  today: string,
  toLocal: (iso: string) => string,
): Map<string, StepRuleView> {
  const completedKeys = items.filter((i) => i.status === "completed" && i.template_key).map((i) => i.template_key as string);
  const phaseStart = new Map(phases.map((p) => [p.id, p.started_at ? toLocal(p.started_at) : null]));
  const out = new Map<string, StepRuleView>();
  for (const it of items) {
    const ref = it.ref ?? {};
    const evidenceRule = readEvidenceRule(ref.evidence);
    const evidence = readEvidence(it.evidence);
    const lock =
      it.status === "pending"
        ? lockPlan({
            lock: ref.lock,
            anchors: { serviceCreated: toLocal(service.created_at), serviceStart: service.starts_on, phaseStart: phaseStart.get(it.phase_id) ?? null },
            today,
            completedKeys,
          })
        : { locked: false, until: null, waiting_item_key: null };
    out.set(it.id, { lock, evidenceRule, evidence, evidenceMissing: it.status === "pending" && evidenceMissing(evidenceRule, evidence) });
  }
  return out;
}
