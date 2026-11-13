// @plantilla-quitar(servicios)
/**
 * Las reglas puras del motor del servicio (S04, 00333). Cada una es gemela de una funcion SQL de
 * `app_servicio` y comparte su archivo de casos (`*.cases.json`) con ella: vitest corre los casos contra
 * estas funciones y `verify-services` contra la base.
 *
 * - `ruleMet` ↔ `svc_rule_met` (F6, F95)               auto-creation.cases.json
 * - `renewalPlan` ↔ `svc_renewal_plan` (F9, F115)       renewal.cases.json
 * - `dueDate` ↔ `svc_due_date` (F15)                    due.cases.json
 * - `phaseShouldAdvance` ↔ `svc_phase_should_advance` (F16) advance.cases.json
 * - `occurrenceDates` ↔ `svc_occurrence_dates` (F21)    recurrence.cases.json
 * - `computeLight` ↔ `svc_light` (F24)                  light.cases.json
 * - `extendPlan` ↔ `svc_extend_plan` (F93)              extend.cases.json
 * - `resumeDays` ↔ `svc_resume_plan` (F94)              pause.cases.json
 * - `pickOwner` ↔ `svc_owner_pick_plan` (F96)           owner-pick.cases.json
 *
 * Fechas: strings `YYYY-MM-DD` (fechas civiles, sin zona). La base las calcula en la zona del negocio.
 */

// ── Fechas civiles ─────────────────────────────────────────────────────────
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number): string {
  // Igual que Postgres (`date + interval 'N months'`): el 31/1 + 1 mes = 28 o 29/2.
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── F6: ¿la venta cumple la regla? ─────────────────────────────────────────
export type WhenRuleName = "any_payment" | "non_reservation" | "percent" | "amount";
export interface RuleInput {
  rule: WhenRuleName;
  value: number | null;
  /** Lo cobrado: pagos paid que no son reembolso, menos los reembolsos paid (en centimos). */
  collectedCents: number;
  totalCents: number;
  /** Hay un pago paid que no es reserva ni reembolso. */
  hasNonReservationPaid: boolean;
  /** Hay al menos un pago paid que no es reembolso. */
  hasAnyPaid: boolean;
}
export function ruleMet(i: RuleInput): boolean {
  switch (i.rule) {
    case "any_payment":
      return i.hasAnyPaid && i.collectedCents > 0;
    case "non_reservation":
      return i.hasNonReservationPaid;
    case "percent":
      return i.totalCents > 0 && i.value !== null && i.collectedCents * 100 >= i.value * i.totalCents;
    case "amount":
      return i.value !== null && i.collectedCents >= i.value;
    default:
      return false;
  }
}

// ── F9: si vuelve a comprar ────────────────────────────────────────────────
export interface RenewalInput {
  renewal: "new_linked" | "extend" | "ask";
  /** El servicio previo del mismo producto (el mas reciente), o null. */
  prev: { status: string; endsOn: string | null; endedOn: string | null } | null;
  today: string;
}
export interface RenewalPlan {
  action: "new" | "new_linked" | "extend" | "ask" | "recovery";
  startsOn: string | null;
}
export function renewalPlan(i: RenewalInput): RenewalPlan {
  const p = i.prev;
  if (!p || p.status === "cancelled" || p.status === "pending_confirmation") return { action: "new", startsOn: null };
  const running = p.status === "active" || p.status === "paused";
  const ended = p.endedOn ?? p.endsOn;
  if (!running && ended && daysBetween(ended, i.today) > 60) return { action: "recovery", startsOn: null };
  if (i.renewal === "extend") return { action: "extend", startsOn: null };
  if (i.renewal === "ask") return { action: "ask", startsOn: null };
  // Servicio nuevo enlazado: empieza el dia siguiente al fin del anterior (si sigue corriendo).
  const startsOn = running && p.endsOn && p.endsOn >= i.today ? addDays(p.endsOn, 1) : null;
  return { action: "new_linked", startsOn };
}

// ── F15: el plazo de un paso ───────────────────────────────────────────────
export interface DueAnchors {
  serviceCreated?: string | null;
  serviceStart?: string | null;
  phaseStart?: string | null;
  itemCompleted?: string | null;
}
export function dueDate(rule: { from: string; days: number } | null | undefined, a: DueAnchors): string | null {
  if (!rule) return null;
  const base =
    rule.from === "service_created" ? a.serviceCreated
    : rule.from === "service_start" ? a.serviceStart
    : rule.from === "phase_start" ? a.phaseStart
    : rule.from === "item_completed" ? a.itemCompleted
    : null;
  return base ? addDays(base, rule.days) : null;
}

// ── F16: ¿avanza la fase? ──────────────────────────────────────────────────
export function phaseShouldAdvance(advance: string, requiredTotal: number, requiredDone: number, allTotal: number, allDone: number): boolean {
  if (advance === "auto") return requiredDone >= requiredTotal;
  if (advance === "auto_all") return allDone >= allTotal;
  return false;
}

// ── F21: las fechas de las repeticiones ────────────────────────────────────
export interface Recurrence {
  every: "day" | "week" | "n_days";
  n?: number | null;
  until: "phase_end" | "service_end" | "n_days" | "n_times";
  n_until?: number | null;
}
export interface Occurrence {
  index: number;
  occursOn: string;
  dueOn: string;
}
/** Las repeticiones que ya llegaron (occursOn <= upTo), desde `start`. Nunca devuelve mas de 1000. */
export function occurrenceDates(r: Recurrence, start: string, phaseEnd: string | null, serviceEnd: string | null, upTo: string): Occurrence[] {
  const step = r.every === "day" ? 1 : r.every === "week" ? 7 : Math.max(1, r.n ?? 1);
  const limitDate =
    r.until === "phase_end" ? phaseEnd
    : r.until === "service_end" ? serviceEnd
    : r.until === "n_days" ? addDays(start, Math.max(1, r.n_until ?? 1) - 1)
    : null;
  const maxCount = r.until === "n_times" ? Math.max(1, r.n_until ?? 1) : 1000;
  const out: Occurrence[] = [];
  for (let k = 0; k < maxCount; k++) {
    const occursOn = addDays(start, k * step);
    if (limitDate && occursOn > limitDate) break;
    if (occursOn > upTo) break;
    out.push({ index: k + 1, occursOn, dueOn: addDays(occursOn, step - 1) });
  }
  return out;
}

// ── F24: el semaforo ───────────────────────────────────────────────────────
export type LightColor = "green" | "yellow" | "red" | "grey";
export interface LightInput {
  /** Gris: pausado, por confirmar, terminado, cancelado, renovado, de prueba o sin empezar. */
  grey: boolean;
  phase: { name: string; daysIn: number; yellowDay: number | null; redDay: number | null } | null;
  /** Dias del pago vencido mas viejo de la venta, o null. */
  oldestOverdueDays: number | null;
  overdueRedDays: number;
  late: { enabled: boolean; yellowAt: number; redAt: number; count: number; phaseName: string } | null;
  items: Array<{ name: string; daysOverdue: number; yellowAfter: number | null; redAfter: number | null }>;
}
export interface LightResult {
  color: LightColor;
  reason: string | null;
}
const RANK: Record<LightColor, number> = { grey: -1, green: 0, yellow: 1, red: 2 };
function dayWord(n: number): string {
  return n === 1 ? "1 día" : `${n} días`;
}
export function computeLight(i: LightInput): LightResult {
  if (i.grey) return { color: "grey", reason: null };
  const found: LightResult[] = [];
  // 1. Tiempo de la fase en curso.
  if (i.phase) {
    const { name, daysIn, yellowDay, redDay } = i.phase;
    if (redDay !== null && daysIn >= redDay) found.push({ color: "red", reason: `Fase ${name} · lleva ${dayWord(daysIn)} · rojo desde el día ${redDay}` });
    else if (yellowDay !== null && daysIn >= yellowDay) found.push({ color: "yellow", reason: `Fase ${name} · lleva ${dayWord(daysIn)} · amarillo desde el día ${yellowDay}` });
  }
  // 2. Pagos de la venta.
  if (i.oldestOverdueDays !== null) {
    if (i.oldestOverdueDays > i.overdueRedDays) found.push({ color: "red", reason: `Pago vencido hace ${dayWord(i.oldestOverdueDays)}` });
    else found.push({ color: "yellow", reason: `Pago vencido hace ${dayWord(i.oldestOverdueDays)}` });
  }
  // 3. Entregas atrasadas de la fase.
  if (i.late && i.late.enabled && i.late.count > 0) {
    const reason = `${i.late.count} ${i.late.count === 1 ? "entrega atrasada" : "entregas atrasadas"} en ${i.late.phaseName}`;
    if (i.late.count >= i.late.redAt) found.push({ color: "red", reason });
    else if (i.late.count >= i.late.yellowAt) found.push({ color: "yellow", reason });
  }
  // 4. Items vencidos con su propia regla (decision 457). El que da el peor color; empate, el mas vencido.
  let worstItem: { color: LightColor; d: number; reason: string } | null = null;
  for (const it of i.items) {
    const d = it.daysOverdue;
    let color: LightColor | null = null;
    let since: number | null = null;
    if (it.redAfter !== null && d >= it.redAfter) {
      color = "red";
      since = it.redAfter;
    } else if (it.yellowAfter !== null && d >= it.yellowAfter) {
      color = "yellow";
      since = it.yellowAfter;
    }
    if (!color || since === null) continue;
    const word = color === "red" ? "rojo" : "amarillo";
    const reason = d === 0 ? `Ítem vence hoy: ${it.name} · ${word} desde el día ${since}` : `Ítem vencido hace ${dayWord(d)}: ${it.name} · ${word} desde el día ${since}`;
    if (!worstItem || RANK[color] > RANK[worstItem.color] || (RANK[color] === RANK[worstItem.color] && d > worstItem.d)) worstItem = { color, d, reason };
  }
  if (worstItem) found.push({ color: worstItem.color, reason: worstItem.reason });
  // Gana el peor; con empate, el de la primera fuente.
  let best: LightResult = { color: "green", reason: null };
  for (const f of found) if (RANK[f.color] > RANK[best.color]) best = f;
  return best;
}

// ── F93: extender ──────────────────────────────────────────────────────────
export interface ExtendInput {
  status: string;
  endsOn: string | null;
  today: string;
  mode: "end_date" | "period";
  endOn?: string | null;
  n?: number | null;
  unit?: "days" | "weeks" | "months";
  from?: "current_end" | "today" | null;
}
export type ExtendPlan = { ok: true; newEnd: string; reactivate: boolean } | { ok: false; error: "SV030" | "SV031" | "SV032" };
export function extendPlan(i: ExtendInput): ExtendPlan {
  if (!["active", "paused", "completed"].includes(i.status)) return { ok: false, error: "SV030" };
  let newEnd: string;
  if (i.mode === "end_date") {
    if (!i.endOn) return { ok: false, error: "SV032" };
    newEnd = i.endOn;
  } else {
    const n = i.n ?? 0;
    if (n < 1) return { ok: false, error: "SV032" };
    const running = i.status === "active" || i.status === "paused";
    const from = i.from ?? (running && i.endsOn ? "current_end" : "today");
    const base = from === "current_end" && i.endsOn ? i.endsOn : i.today;
    newEnd = i.unit === "months" ? addMonths(base, n) : addDays(base, i.unit === "weeks" ? n * 7 : n);
  }
  if (newEnd <= i.today) return { ok: false, error: "SV031" };
  return { ok: true, newEnd, reactivate: i.status === "completed" };
}

// ── F94: cuantos dias se corren al reanudar ────────────────────────────────
/** Dias corridos desde la pausa, redondeado hacia arriba; `shiftDays` los reemplaza. */
export function resumeDays(pausedAt: string, now: string, shiftDays?: number | null): number {
  if (shiftDays !== undefined && shiftDays !== null) return Math.max(0, Math.floor(shiftDays));
  const ms = Date.parse(now) - Date.parse(pausedAt);
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

// ── F96: a quien va el servicio ────────────────────────────────────────────
export interface OwnerPickInput {
  mode: "fixed" | "round_robin" | "conditions" | "previous";
  userId: string | null;
  members: string[];
  /** Servicios activos o pausados de ESE producto, por persona. */
  activeCounts: Record<string, number>;
  /** Cuando recibio su ultimo servicio cada persona (ISO), o ausente si nunca. */
  lastAssignedAt: Record<string, string>;
  /** La persona que eligen las condiciones (la primera que se cumple), o null. */
  conditionUserId: string | null;
  /** El reparto de la condicion que se cumplio (si eligio un reparto en vez de una persona). */
  conditionMembers: string[] | null;
  previousOwner: string | null;
  fallback: string | null;
  /** Personas que hoy son miembros del negocio. */
  activeMembers: string[];
  /**
   * Servicios A4 (F151): el tope de cartera de cada persona (vacío = sin tope) y cuántos servicios tiene hoy a cargo
   * (activos, pausados o por confirmar, de TODOS los productos). Sin topes, elige exactamente igual que antes.
   */
  capacity?: Record<string, number>;
  loadCounts?: Record<string, number>;
}
export interface OwnerPick {
  userId: string | null;
  usedFallback: boolean;
  /** Solo si quedó en el respaldo porque todos los del reparto llegaron a su tope (aviso `svc_capacity_full`). */
  capacityFull?: true;
}
/** Si la persona llegó a su tope de cartera. */
export function atCapacity(i: Pick<OwnerPickInput, "capacity" | "loadCounts">, u: string): boolean {
  const cap = i.capacity?.[u];
  if (cap === undefined || cap === null) return false;
  return (i.loadCounts?.[u] ?? 0) >= cap;
}
function roundRobin(members: string[], i: OwnerPickInput): string | null {
  const live = members.filter((m) => i.activeMembers.includes(m) && !atCapacity(i, m));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const ca = i.activeCounts[a] ?? 0;
    const cb = i.activeCounts[b] ?? 0;
    if (ca !== cb) return ca - cb;
    const la = i.lastAssignedAt[a] ?? "";
    const lb = i.lastAssignedAt[b] ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : 1;
  })[0];
}
export function pickOwner(i: OwnerPickInput): OwnerPick {
  const live = (u: string | null) => (u && i.activeMembers.includes(u) ? u : null);
  let chosen: string | null = null;
  if (i.mode === "fixed") chosen = live(i.userId);
  else if (i.mode === "round_robin") chosen = roundRobin(i.members, i);
  else if (i.mode === "previous") chosen = live(i.previousOwner);
  else if (i.mode === "conditions") {
    chosen = live(i.conditionUserId);
    if (chosen && atCapacity(i, chosen)) chosen = null;
    if (!chosen && i.conditionMembers) chosen = roundRobin(i.conditionMembers, i);
    if (!chosen && i.members.length > 0) chosen = roundRobin(i.members, i);
  }
  if (chosen) return { userId: chosen, usedFallback: false };
  // Si sin los topes hubiera habido alguien, el respaldo fue por los topes: se avisa.
  const hadCapacity = i.capacity && Object.keys(i.capacity).length > 0;
  const withoutCaps = hadCapacity && (i.mode === "round_robin" || i.mode === "conditions") ? pickOwner({ ...i, capacity: {} }) : null;
  if (withoutCaps && !withoutCaps.usedFallback) return { userId: live(i.fallback), usedFallback: true, capacityFull: true };
  return { userId: live(i.fallback), usedFallback: true };
}
