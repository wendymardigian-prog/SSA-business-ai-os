/**
 * Cuando se recolecta cada cosa, y como se compara (F45).
 *
 * Cuatro reglas que valen para todas las redes:
 *
 * 1. **Frecuencia por antiguedad.** Un post de ayer cambia todos los dias;
 *    uno de hace cuatro meses no cambia nunca. Pedirle a la API los mil
 *    posts historicos cada noche quema la cuota y no aporta un dato.
 * 2. **Un dia sin dato no tiene fila.** Nunca un cero inventado.
 * 3. **La fecha es la del workspace**, no UTC. "El lunes" tiene que ser el
 *    lunes de quien mira.
 * 4. **Engagement comparable a 7 dias.** Comparar un post de ayer con uno de
 *    hace un mes por sus numeros totales es comparar cualquier cosa: el
 *    viejo tuvo treinta dias para juntar likes. A los 7 dias se congela y
 *    recien ahi se comparan entre si.
 */

/** Hasta esta antiguedad, todos los dias. */
export const DAILY_UNTIL_DAYS = 30;

/** Hasta esta, una vez por semana. */
export const WEEKLY_UNTIL_DAYS = 90;

/** A los cuantos dias se congela el engagement comparable. */
export const D7_DAYS = 7;

/** Los dos ultimos dias de Instagram todavia pueden subir. */
export const INSTAGRAM_LAG_DAYS = 2;

export type Cadence = "daily" | "weekly" | "never";

/** Cada cuanto se actualiza un post, segun cuantos dias tiene. */
export function cadenceFor(ageDays: number): Cadence {
  if (ageDays <= DAILY_UNTIL_DAYS) return "daily";
  if (ageDays <= WEEKLY_UNTIL_DAYS) return "weekly";
  // Mas de 90 dias: lo que tenga es lo que va a tener.
  return "never";
}

/** Los dias entre dos fechas, sin hora. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Si este post entra en la recoleccion de hoy.
 *
 * `lastSyncedAt` null = nunca se leyo, asi que entra igual aunque sea viejo:
 * es la primera vez.
 */
export function shouldCollect(params: {
  publishedAt: string | null;
  lastSyncedAt: string | null;
  now: Date;
}): boolean {
  if (!params.publishedAt) return false;

  const age = daysBetween(params.publishedAt, params.now);
  const cadence = cadenceFor(age);
  if (cadence === "never") return false;
  if (!params.lastSyncedAt) return true;

  const since = daysBetween(params.lastSyncedAt, params.now);
  return cadence === "daily" ? since >= 1 : since >= 7;
}

/**
 * La fecha de hoy en la zona del workspace, como `YYYY-MM-DD`.
 *
 * `en-CA` da exactamente ese formato, que es la unica razon por la que
 * aparece un locale canadiense en un sistema en castellano.
 */
export function workspaceDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // Una zona invalida no puede dejar sin recolectar: se cae a UTC.
    return now.toISOString().slice(0, 10);
  }
}

/** La hora local del workspace, 0 a 23. */
export function workspaceHour(now: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now),
    );
  } catch {
    return now.getUTCHours();
  }
}

/** A que hora local corre la recoleccion. */
export const SYNC_HOUR = 3;

/** Si a este workspace le toca sincronizar en esta corrida del cron. */
export function isSyncHour(now: Date, timeZone: string): boolean {
  return workspaceHour(now, timeZone) === SYNC_HOUR;
}

// ── Engagement comparable a 7 dias ───────────────────────────────────────

export interface DailyPoint {
  date: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface D7Result {
  engagement: number | null;
  interactions: number | null;
  reach: number | null;
  views: number | null;
  computedAt: string;
}

/**
 * Congela el engagement del post a los 7 dias.
 *
 * Se toma la fila del dia 7, o la primera posterior si ese dia no hay: una
 * red que fallo un dia no puede dejar al post sin numero comparable para
 * siempre. Se usa la POSTERIOR y no la anterior porque las metricas son
 * acumuladas: la del dia 8 incluye los 7 primeros dias.
 *
 * El denominador es el alcance, y si no hay, las vistas. Sin ninguno de los
 * dos no hay tasa: se devuelven las interacciones igual, que ya sirven para
 * ordenar.
 */
export function computeD7(params: {
  publishedAt: string;
  daily: DailyPoint[];
  now: Date;
}): D7Result | null {
  const age = daysBetween(params.publishedAt, params.now);
  // Antes de los 7 dias el numero no seria comparable: la pantalla dice
  // "en curso".
  if (age < D7_DAYS) return null;

  const cutoff = new Date(new Date(params.publishedAt).getTime() + D7_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const point = params.daily
    .filter((d) => d.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  if (!point) return null;

  const parts = [point.likes, point.comments, point.shares, point.saves].filter(
    (v): v is number => typeof v === "number",
  );
  const interactions = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;

  const denominator = point.reach ?? point.views;
  const engagement =
    interactions !== null && denominator !== null && denominator > 0
      ? Number(((interactions / denominator) * 100).toFixed(2))
      : null;

  return {
    engagement,
    interactions,
    reach: point.reach,
    views: point.views,
    computedAt: new Date(params.now).toISOString(),
  };
}

/** Si al post le falta para tener numero comparable, y cuanto. */
export function d7Status(
  publishedAt: string | null,
  now: Date,
): { ready: boolean; daysLeft: number } {
  if (!publishedAt) return { ready: false, daysLeft: D7_DAYS };
  const age = daysBetween(publishedAt, now);
  return { ready: age >= D7_DAYS, daysLeft: Math.max(0, D7_DAYS - age) };
}

/**
 * Si un dato puede todavia subir.
 *
 * Instagram tarda hasta dos dias en cerrar sus numeros. Mostrar el de ayer
 * como definitivo hace que alguien compare un dia cerrado con uno a medio
 * contar y saque una conclusion equivocada.
 */
export function mayStillGrow(params: { platform: string; date: string; today: string }): boolean {
  if (params.platform !== "instagram") return false;
  return daysBetween(params.date, params.today) < INSTAGRAM_LAG_DAYS;
}

/**
 * Desde cuando hay datos, en palabras.
 *
 * Hace falta porque casi ninguna red da historial: la serie empieza el dia
 * que se conecto la cuenta. Un grafico que arranca en octubre sin decir por
 * que parece un grafico con datos perdidos.
 */
export function dataSinceLabel(firstDate: string | null): string | null {
  if (!firstDate) return null;
  const formatted = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${firstDate}T00:00:00Z`));
  return `Datos desde el ${formatted}`;
}
