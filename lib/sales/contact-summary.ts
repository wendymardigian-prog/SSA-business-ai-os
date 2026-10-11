/**
 * La línea de último toque y asignación en la ficha del contacto (plano F12).
 * No se cachea nada en `contacts`: el último toque se lee de la atribución
 * canónica que ya existe, y el nombre de la regla del último `audit_log` de
 * asignación automática (actor sistema).
 */
import { attributionFromContact, describeAttribution } from "./attribution";

export type AssignmentLineKind = "setter" | "vendedor";

export interface ContactSummaryInput {
  attribution: unknown;
  now: Date;
  timeZone: string;
  setterName: string | null;
  vendedorName: string | null;
  /** `contacts.assignment_locked_at`: alguien asignó a mano. */
  locked: boolean;
  /** El nombre de la regla de la última asignación automática, por tipo (si el historial se ve). */
  automaticRule: Partial<Record<AssignmentLineKind, string>>;
}

export interface ContactSummary {
  touchLine: string;
  assignmentLines: Array<{ kind: AssignmentLineKind; label: string; text: string }>;
}

function assignmentText(label: string, name: string | null, locked: boolean, rule: string | undefined): string {
  if (!name) return `${label}: sin asignar`;
  if (locked) return `${label}: ${name} (asignado a mano)`;
  if (rule) return `${label}: ${name} (por la regla ${rule})`;
  return `${label}: ${name}`;
}

export function summarizeContact(input: ContactSummaryInput): ContactSummary {
  const last = attributionFromContact({ attribution: input.attribution });
  return {
    touchLine: last ? describeAttribution(last, input.now, input.timeZone) : "Sin atribución",
    assignmentLines: [
      { kind: "setter", label: "Setter", text: assignmentText("Setter", input.setterName, input.locked, input.automaticRule.setter) },
      { kind: "vendedor", label: "Vendedor", text: assignmentText("Vendedor", input.vendedorName, input.locked, input.automaticRule.vendedor) },
    ],
  };
}

/** De las filas de `audit_log` del contacto, la última asignación automática (actor sistema) por tipo. */
export function automaticRulesFromAudit(
  rows: ReadonlyArray<{ action: string; actor_type?: string | null; actor_label?: string | null; metadata?: unknown; performed_at: string }>,
): Partial<Record<AssignmentLineKind, string>> {
  const out: Partial<Record<AssignmentLineKind, string>> = {};
  const sorted = [...rows].sort((a, b) => Date.parse(b.performed_at) - Date.parse(a.performed_at));
  for (const row of sorted) {
    if (row.action !== "assignment.automatic" || row.actor_type !== "system" || !row.actor_label) continue;
    const kind = (row.metadata as { kind?: string } | null)?.kind;
    if ((kind === "setter" || kind === "vendedor") && !out[kind]) out[kind] = row.actor_label;
  }
  return out;
}
