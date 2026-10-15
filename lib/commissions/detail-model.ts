/**
 * El detalle de una comisión (F61). Puro: compara la regla con la que se calculó (la foto guardada en
 * `rule_snapshot`) con la regla actual, para decir «esta regla cambió desde entonces».
 */
import { canonicalJson } from "./audit-diff";
import type { CommissionRule } from "./types";

/** Lo que cambió de una regla desde que se generó la comisión. Se compara solo lo que define el cálculo. */
const COMPARED: Array<{ key: keyof CommissionRule; label: string }> = [
  { key: "name", label: "El nombre" },
  { key: "calc_type", label: "El tipo de cálculo" },
  { key: "rate", label: "El porcentaje" },
  { key: "fixed_amount", label: "El monto fijo" },
  { key: "base", label: "La base del cálculo" },
  { key: "conditions", label: "Las condiciones" },
];

export interface RuleComparison {
  /** `false` = sigue siendo la misma regla (o no hay con qué comparar). */
  changed: boolean;
  /** Qué cambió, en palabras. */
  fields: string[];
  /** La regla actual está archivada. */
  archived: boolean;
  /** No se puede ver la regla actual (otro alcance) o ya no está: no se comparó. */
  unknown: boolean;
}

export function compareRuleSnapshot(snapshot: unknown, current: CommissionRule | null): RuleComparison {
  const snap = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as Record<string, unknown>) : null;
  if (!snap || !current) return { changed: false, fields: [], archived: !!current?.archived_at, unknown: true };
  const fields = COMPARED.filter(({ key }) => canonicalJson(snap[key]) !== canonicalJson(current[key])).map(({ label }) => label);
  return { changed: fields.length > 0, fields, archived: !!current.archived_at, unknown: false };
}
