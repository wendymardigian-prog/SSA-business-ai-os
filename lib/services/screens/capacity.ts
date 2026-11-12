// @plantilla-quitar(servicios)
/**
 * «Reparto de clientes» (Servicios A4, F151): el tope de servicios a cargo de cada persona. PURO.
 * Lo que se guarda es `workspaces.service_team_settings.capacity` = {"<user_id>": 1..1000}; vacío = sin tope.
 * Lo usa el reparto automático (`pickOwner` / `svc_owner_pick_plan`); asignar a mano no se frena, solo avisa.
 */
export const CAPACITY_MAX = 1000;

export function readCapacity(settings: unknown): Record<string, number> {
  const c = (settings && typeof settings === "object" ? (settings as Record<string, unknown>).capacity : null) as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || Array.isArray(c)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= CAPACITY_MAX) out[k] = n;
  }
  return out;
}

export interface CapacityRow {
  id: string;
  name: string;
  cap: number | null;
  load: number;
  /** «12 de 20» o «12» sin tope. */
  label: string;
  full: boolean;
}

export function capacityRows(members: Array<{ id: string; name: string }>, capacity: Record<string, number>, loads: Record<string, number>): CapacityRow[] {
  return members.map((m) => {
    const cap = capacity[m.id] ?? null;
    const load = Number(loads[m.id]) || 0;
    return { id: m.id, name: m.name, cap, load, label: cap ? `${load} de ${cap}` : String(load), full: cap !== null && load >= cap };
  });
}

/** Lo que escribió la persona → los topes a guardar. Vacío = sin tope; si no, un entero de 1 a 1000. */
export function parseCapacityInput(entries: Record<string, string>, memberIds: string[]): { ok: true; capacity: Record<string, number> } | { ok: false; error: string } {
  const ids = new Set(memberIds);
  const capacity: Record<string, number> = {};
  for (const [id, raw] of Object.entries(entries)) {
    if (!ids.has(id)) continue;
    const v = raw.trim();
    if (!v) continue;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > CAPACITY_MAX) return { ok: false, error: `El tope va de 1 a ${CAPACITY_MAX} (o vacío para no poner tope).` };
    capacity[id] = Number(v);
  }
  return { ok: true, capacity };
}

/** «Supera su tope» al asignar a mano (no frena). */
export function overCapacityNote(userId: string, capacity: Record<string, number>, loads: Record<string, number>): string | null {
  const cap = capacity[userId];
  if (!cap) return null;
  const load = Number(loads[userId]) || 0;
  return load >= cap ? `Supera su tope (${load} de ${cap})` : null;
}
