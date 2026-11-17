// @plantilla-quitar(proyectos)
/**
 * Sala de la fama (F80, F120), pura. Gemela de `app_servicio_proyectos.fame_plan` (00395); los casos de
 * `fame.cases.json` corren contra las dos. `fame_ranking(product_id, period)` junta los datos del programa (sin los
 * servicios de prueba) y llama a la de la base.
 *
 * Qué cuenta (`settings.counts`): lo cobrado (`paid`, la suma de los pagos) o lo vendido (`sold`, los proyectos reales
 * desde Ganado). Con `verified_only` (por defecto sí) un pago sin verificar no suma; los ajustes del equipo siempre.
 * Lo de antes del programa suma solo con `include_before_program`. «Este mes» = del 1 del mes del negocio a hoy.
 */
export interface FameEntry {
  contact_id: string;
  kind: "payment" | "adjustment";
  amount_cents: number;
  received_on: string;
  before_program?: boolean;
  verified?: boolean;
}

export interface FameProject {
  contact_id: string;
  kind: string;
  status: string | null;
  sold_cents: number | null;
  closed_on: string | null;
}

export interface FameSettings {
  counts?: "paid" | "sold";
  verified_only?: boolean;
  include_before_program?: boolean;
}

export interface FameRow {
  contact_id: string;
  amount_cents: number;
  projects_won: number;
}

const WON = ["won", "in_build", "delivered"];

export function fameRanking(entries: FameEntry[], projects: FameProject[], settings: FameSettings, period: "all" | "month", today: string): FameRow[] {
  const counts = settings.counts || "paid";
  const verifiedOnly = settings.verified_only ?? true;
  const beforeOk = settings.include_before_program ?? false;
  const m0 = `${today.slice(0, 7)}-01`;
  const inPeriod = (d: string | null) => period !== "month" || (d !== null && d >= m0 && d <= today);

  const paid = new Map<string, number>();
  for (const e of entries) {
    if (!(e.kind === "adjustment" || !verifiedOnly || e.verified)) continue;
    if (!beforeOk && e.before_program) continue;
    if (!inPeriod(e.received_on)) continue;
    paid.set(e.contact_id, (paid.get(e.contact_id) ?? 0) + e.amount_cents);
  }
  const won = projects.filter((p) => p.kind !== "practice" && p.status !== null && WON.includes(p.status) && inPeriod(p.closed_on));
  const sold = new Map<string, number>();
  const n = new Map<string, number>();
  for (const p of won) {
    sold.set(p.contact_id, (sold.get(p.contact_id) ?? 0) + (p.sold_cents ?? 0));
    n.set(p.contact_id, (n.get(p.contact_id) ?? 0) + 1);
  }
  const ids = new Set([...paid.keys(), ...sold.keys()]);
  return [...ids]
    .map((id) => ({ contact_id: id, amount_cents: Math.max(0, (counts === "sold" ? sold.get(id) : paid.get(id)) ?? 0), projects_won: n.get(id) ?? 0 }))
    .filter((r) => r.amount_cents > 0)
    .sort((a, b) => b.amount_cents - a.amount_cents || b.projects_won - a.projects_won || (a.contact_id < b.contact_id ? -1 : a.contact_id > b.contact_id ? 1 : 0));
}
