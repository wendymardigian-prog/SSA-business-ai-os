// @plantilla-quitar(servicios)
/**
 * El motor de accesos al portal (F37, F109), puro. Gemelas SQL (00341):
 * - `accessWindow` ↔ `app_servicio.portal_access_window(jsonb)`: si una sección se abre ante un hecho y hasta qué día.
 * - `untilReached` ↔ `app_servicio.portal_access_until_reached(jsonb)`: si un hecho cierra un acceso abierto.
 * - `pickEffective` ↔ `app_servicio.portal_access_pick(jsonb)`: de varios accesos a la misma sección y programa, el que vale.
 * Los casos de `access-rule.cases.json` y `access.cases.json` corren contra las dos.
 *
 * Las fechas son DÍAS del negocio (`YYYY-MM-DD`): la base convierte el último día a las 23:59:59 de su zona. «Todavía
 * no» = no hay fila; una fila revocada se conserva.
 */

export type AccessEventType = "service_start" | "tick" | "phase_completed" | "item_completed" | "module_completed" | "challenge_started";

export interface AccessRule {
  opens?: { type?: string; ref?: string | null; days?: number | null; date?: string | null } | null;
  until?: { type?: string; ref?: string | null; n?: number | null; date?: string | null } | null;
}

export interface AccessWindowInput {
  rule: AccessRule;
  event: { type: AccessEventType; ref?: string | null };
  /** El inicio y el fin del servicio (días del negocio). */
  startsOn: string | null;
  endsOn: string | null;
  /** Hoy en el negocio. */
  today: string;
}

export type AccessWindow = { action: "none" } | { action: "open"; endsOn: string | null; untilType: string };

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Suma meses como Postgres (`date + interval 'N months'`): si el día no existe, el último del mes. */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Hasta qué día dura un acceso que se abre hoy. null = sin fecha (para siempre, o se cierra por un hecho). */
export function untilDay(until: AccessRule["until"], today: string, endsOn: string | null): string | null {
  const t = until?.type ?? "service";
  if (t === "service") return endsOn;
  if (t === "days") return typeof until?.n === "number" && until.n > 0 ? addDays(today, until.n) : null;
  if (t === "months") return typeof until?.n === "number" && until.n > 0 ? addMonths(today, until.n) : null;
  if (t === "fixed_date") return until?.date ?? null;
  return null;
}

function opensNow(input: AccessWindowInput): boolean {
  const o = input.rule.opens ?? { type: "service_start" };
  const type = o.type ?? "service_start";
  const ev = input.event;
  switch (type) {
    case "service_start":
      return ev.type === "service_start" || ev.type === "tick";
    case "days_after_start": {
      if (ev.type !== "service_start" && ev.type !== "tick") return false;
      if (!input.startsOn) return false;
      const days = typeof o.days === "number" && o.days > 0 ? o.days : 0;
      return input.today >= addDays(input.startsOn, days);
    }
    case "fixed_date":
      return (ev.type === "service_start" || ev.type === "tick") && !!o.date && input.today >= o.date;
    case "phase_completed":
    case "item_completed":
    case "module_completed":
      return ev.type === type && !!o.ref && ev.ref === o.ref;
    case "challenge_started":
      return ev.type === "challenge_started";
    default:
      // journey_item y automation: los abre el paso «Se abre» o la acción «Dar acceso», nunca un hecho.
      return false;
  }
}

export function accessWindow(input: AccessWindowInput): AccessWindow {
  if (!opensNow(input)) return { action: "none" };
  const untilType = input.rule.until?.type ?? "service";
  const endsOn = untilDay(input.rule.until, input.today, input.endsOn);
  // Un acceso que ya terminó antes de abrirse no se crea.
  if (endsOn !== null && endsOn < input.today) return { action: "none" };
  return { action: "open", endsOn, untilType };
}

/** Si un hecho cierra un acceso abierto («hasta completar la fase / el paso»). */
export function untilReached(until: AccessRule["until"], event: { type: AccessEventType; ref?: string | null }): boolean {
  const t = until?.type;
  if (t !== "phase_completed" && t !== "item_completed") return false;
  return event.type === t && !!until?.ref && event.ref === until.ref;
}

export interface AccessRow {
  id: string;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
  suspended_overdue_at: string | null;
  suspended_pause_at: string | null;
}

/** De varios accesos a la misma sección y programa, el vigente con el fin más lejano (sin fin gana). null si ninguno. */
export function pickEffective(rows: AccessRow[], now: string): string | null {
  const t = Date.parse(now);
  const live = rows.filter(
    (r) => !r.revoked_at && !r.suspended_overdue_at && !r.suspended_pause_at && Date.parse(r.starts_at) <= t && (r.ends_at === null || Date.parse(r.ends_at) >= t),
  );
  if (live.length === 0) return null;
  live.sort((a, b) => {
    if (a.ends_at === null && b.ends_at !== null) return -1;
    if (b.ends_at === null && a.ends_at !== null) return 1;
    if (a.ends_at !== null && b.ends_at !== null && a.ends_at !== b.ends_at) return Date.parse(b.ends_at) - Date.parse(a.ends_at);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return live[0].id;
}

export type AccessRowState = "active" | "expiring" | "expired" | "suspended_pause" | "suspended_overdue" | "revoked" | "pending";

export const ACCESS_STATE_LABELS: Record<AccessRowState, string> = {
  active: "Vigente",
  expiring: "Por vencer",
  expired: "Vencido",
  suspended_pause: "Suspendido por pausa",
  suspended_overdue: "Suspendido por mora",
  revoked: "Revocado",
  pending: "Todavía no se abrió",
};

/** El estado de una fila de la pestaña Accesos (F40). Sin fila = «Todavía no se abrió» (cuando el camino llegue). */
export function accessRowState(row: Omit<AccessRow, "id" | "starts_at"> | null, now: string): AccessRowState {
  if (!row) return "pending";
  if (row.revoked_at) return "revoked";
  if (row.suspended_pause_at) return "suspended_pause";
  if (row.suspended_overdue_at) return "suspended_overdue";
  if (row.ends_at === null) return "active";
  const end = Date.parse(row.ends_at);
  const t = Date.parse(now);
  if (end < t) return "expired";
  if (end - t <= 7 * DAY) return "expiring";
  return "active";
}
