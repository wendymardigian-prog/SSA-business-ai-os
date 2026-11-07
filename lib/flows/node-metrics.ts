/**
 * Las metricas de cada paso en el lienzo. Puro: arma lo que devuelve `flow_node_stats` (00317, formato largo) en una
 * ficha por paso, y decide los textos (la insignia, los porcentajes, el nombre de cada boton).
 *
 * Reglas:
 *  - «Pasaron» son ejecuciones (personas) distintas, no filas: un paso que quedo para despues y despues salio cuenta una.
 *  - El estado de cada ejecucion en el paso es el ULTIMO (lo calcula la base).
 *  - Un porcentaje sin base es «—», nunca 0 %.
 *  - Los clics se cuentan solo con «Registrar el clic» prendido en el paso: sin eso no hay como saber quien toco un boton.
 */

export interface NodeStatRow {
  node_id: string;
  metric: string;
  key: string | null;
  value: number;
}

export interface NodeMetrics {
  passed: number;
  ok: number;
  failed: number;
  skipped: number;
  waiting: number;
  deferred: number;
  /** Fallos por clave de motivo, de mas a menos. */
  failedKinds: Array<{ kind: string; count: number }>;
  /** Fallos por motivo (texto saneado), de mas a menos. */
  failedReasons: Array<{ reason: string; count: number }>;
  /** Por que salida siguio (handle crudo). */
  exits: Record<string, number>;
  /** Conversaciones a las que el paso les mando un mensaje, y las que contestaron en 24 h. */
  sent: number;
  replied: number;
  /** Clics por link del paso (`t`, `b0`…): totales y personas. */
  clicks: Array<{ key: string; total: number; people: number }>;
  /** Personas con al menos un clic en el paso. */
  clickersAny: number;
  emailSent: number;
  emailOpened: number;
  emailClicked: number;
}

export function emptyNodeMetrics(): NodeMetrics {
  return {
    passed: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    waiting: 0,
    deferred: 0,
    failedKinds: [],
    failedReasons: [],
    exits: {},
    sent: 0,
    replied: 0,
    clicks: [],
    clickersAny: 0,
    emailSent: 0,
    emailOpened: 0,
    emailClicked: 0,
  };
}

const STATUS_FIELDS = { ok: "ok", failed: "failed", skipped: "skipped", waiting: "waiting", deferred: "deferred" } as const;

/** Las filas de la base, en una ficha por paso. Una metrica desconocida se ignora (una base mas nueva que el codigo). */
export function buildNodeMetrics(rows: NodeStatRow[]): Record<string, NodeMetrics> {
  const out: Record<string, NodeMetrics> = {};
  const clicks: Record<string, Record<string, { total: number; people: number }>> = {};
  for (const row of rows) {
    if (!row || typeof row.node_id !== "string") continue;
    const m = (out[row.node_id] ??= emptyNodeMetrics());
    const value = Number(row.value) || 0;
    const key = row.key ?? "";
    switch (row.metric) {
      case "passed":
        m.passed = value;
        break;
      case "status":
        if (key in STATUS_FIELDS) m[STATUS_FIELDS[key as keyof typeof STATUS_FIELDS]] = value;
        break;
      case "failed_kind":
        m.failedKinds.push({ kind: key || "unknown", count: value });
        break;
      case "failed_reason":
        if (key) m.failedReasons.push({ reason: key, count: value });
        break;
      case "exit":
        if (key) m.exits[key] = value;
        break;
      case "sent":
        m.sent = value;
        break;
      case "replied":
        m.replied = value;
        break;
      case "clicks":
        ((clicks[row.node_id] ??= {})[key] ??= { total: 0, people: 0 }).total = value;
        break;
      case "clickers":
        ((clicks[row.node_id] ??= {})[key] ??= { total: 0, people: 0 }).people = value;
        break;
      case "clickers_any":
        m.clickersAny = value;
        break;
      case "email_sent":
        m.emailSent = value;
        break;
      case "email_opened":
        m.emailOpened = value;
        break;
      case "email_clicked":
        m.emailClicked = value;
        break;
    }
  }
  for (const [nodeId, byKey] of Object.entries(clicks)) {
    out[nodeId].clicks = Object.entries(byKey)
      .map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => clickKeyOrder(a.key) - clickKeyOrder(b.key) || a.key.localeCompare(b.key));
  }
  for (const m of Object.values(out)) {
    m.failedKinds.sort((a, b) => b.count - a.count);
    m.failedReasons.sort((a, b) => b.count - a.count);
  }
  return out;
}

function clickKeyOrder(key: string): number {
  const button = /^b(\d+)$/.exec(key);
  if (button) return Number(button[1]);
  return key === "t" ? 100 : 200;
}

/** Un porcentaje para mostrar. Sin base, «—». */
export function percent(part: number, base: number): string {
  if (!base || base <= 0) return "—";
  const value = (part / base) * 100;
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1).replace(".", ",")} %`;
}

/** La insignia chica del nodo: cuantas personas pasaron y, si hubo, cuantas fallaron. */
export function badgeText(m: NodeMetrics | undefined): string | null {
  if (!m || m.passed === 0) return null;
  const people = formatCount(m.passed);
  return m.failed > 0 ? `${people} · ${formatCount(m.failed)} ✕` : people;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

/** El nombre de un link del paso: el titulo del boton, «Link del texto», o la clave si el boton ya no existe. */
export function clickKeyLabel(key: string, buttons: Array<{ title?: unknown }> | undefined): string {
  if (key === "t") return "Link del texto";
  const button = /^b(\d+)$/.exec(key);
  if (button) {
    const title = buttons?.[Number(button[1])]?.title;
    return typeof title === "string" && title.trim() ? `Botón «${title.trim()}»` : `Botón ${Number(button[1]) + 1}`;
  }
  const other = /^m(\d+)-(.+)$/.exec(key);
  if (other) return `Mensaje ${Number(other[1]) + 1}: ${clickKeyLabel(other[2], undefined)}`;
  return key || "Link";
}

/** El nombre de una salida del paso para el popover. */
export function exitLabel(handle: string): string {
  if (handle === "true" || handle === "yes") return "Sí";
  if (handle === "false" || handle === "no") return "No";
  if (handle === "else") return "Si no";
  if (handle === "reply") return "Respondió";
  if (handle === "timeout") return "No respondió a tiempo";
  const split = /^split-(\d+)$/.exec(handle);
  if (split) return `Camino ${Number(split[1]) + 1}`;
  return handle;
}

/** Los periodos del boton «Métricas». */
export const METRIC_PERIODS = [
  { key: "7d", label: "Últimos 7 días", days: 7 },
  { key: "30d", label: "Últimos 30 días", days: 30 },
  { key: "90d", label: "Últimos 90 días", days: 90 },
  { key: "all", label: "Desde siempre", days: null },
] as const;

export type MetricPeriod = (typeof METRIC_PERIODS)[number]["key"];

export function isMetricPeriod(value: unknown): value is MetricPeriod {
  return METRIC_PERIODS.some((p) => p.key === value);
}

/** El rango de un periodo. «Desde siempre» arranca en 2020 (antes no habia historial). */
export function periodRange(period: MetricPeriod, now: Date = new Date()): { from: string; to: string } {
  const entry = METRIC_PERIODS.find((p) => p.key === period) ?? METRIC_PERIODS[1];
  const to = new Date(now.getTime() + 60_000);
  const from = entry.days === null ? new Date("2020-01-01T00:00:00Z") : new Date(now.getTime() - entry.days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
