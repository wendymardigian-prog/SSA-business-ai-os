// @plantilla-quitar(servicios)
/**
 * «Una cifra del estudiante llega a…» (`service_metric_reached`, traído de RER y adaptado, 00460/00461). PURA: qué cifras
 * se pueden mirar, sus etiquetas, cuándo se cruza la cifra y lo que impide publicar.
 *
 * Las cifras son del estudiante EN UN PROGRAMA (contacto + producto):
 *   points         la suma de sus puntos (`app_servicio_portal.points_ledger`, A3).
 *   revenue        su facturación cargada, contada como la Sala de la fama del programa: los pagos (por defecto solo los
 *                  verificados) y los ajustes del equipo, sin lo de antes del programa salvo que el programa lo sume. La
 *                  cifra va en unidades de la moneda (1.000 = 1.000 USD); la base compara en centavos.
 *   real_projects  sus proyectos reales ganados (Ganado, En construcción o Entregado), sin los archivados.
 * Facturación y proyectos son de la extensión de proyectos: con la extensión apagada no se emiten.
 *
 * Quién lo emite: la base, en el momento en que la cifra CAMBIA (un trigger por fila en el libro de puntos, en los pagos
 * y en los proyectos). Salta solo si la cifra CRUZA el número (antes por debajo, ahora igual o arriba): publicar una
 * automatización no le escribe a quien ya estaba arriba. Una sola vez por automatización, servicio y cifra
 * (`app_servicio.trigger_anchor_fires`). Gemela de `metricCrossed`: `app_servicio.svc_metric_crossed`.
 */

export const METRIC_TRIGGER = "service_metric_reached";

export const METRICS = [
  "points",
  "revenue", // @plantilla-quitar(proyectos)
  "real_projects", // @plantilla-quitar(proyectos)
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  points: "Puntos del programa",
  revenue: "Facturación cargada", // @plantilla-quitar(proyectos)
  real_projects: "Proyectos reales ganados", // @plantilla-quitar(proyectos)
};

export const METRIC_HINTS: Record<Metric, string> = {
  points: "La suma de sus puntos en el programa (con los programas que tienen los puntos prendidos).",
  revenue: "Como la Sala de la fama del programa: por defecto solo los pagos verificados y sin lo de antes del programa. La cifra va en la moneda de los pagos.", // @plantilla-quitar(proyectos)
  real_projects: "Proyectos reales en Ganado, En construcción o Entregado. Necesita la extensión de proyectos.", // @plantilla-quitar(proyectos)
};

export const MAX_THRESHOLD = 100_000_000;

export interface MetricTriggerConfig {
  metric?: string | null;
  threshold?: number | null;
}

export const isMetric = (v: unknown): v is Metric => typeof v === "string" && (METRICS as readonly string[]).includes(v);

/** Lo que impide publicar. Vacío = bien. */
export function metricConfigProblems(c: MetricTriggerConfig): string[] {
  const out: string[] = [];
  if (!isMetric(c.metric)) out.push("Elegí qué cifra se mira.");
  const n = c.threshold;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_THRESHOLD) out.push("Escribí la cifra: un número entero de 1 en adelante.");
  return out;
}

/** La cifra en la unidad de la base: la facturación se guarda en centavos. */
export function thresholdInBaseUnits(metric: Metric, threshold: number): number {
  return metric === "revenue" ? threshold * 100 : threshold;
}

/** Si un cambio de `before` a `after` cruza la cifra (en unidades de la base). Gemela de `svc_metric_crossed`. */
export function metricCrossed(before: number, after: number, threshold: number): boolean {
  return Number.isFinite(before) && Number.isFinite(after) && threshold >= 1 && before < threshold && after >= threshold;
}

/** La clave de cada disparo (la misma que arma la base): una vez por automatización, servicio, cifra y número. */
export function metricOccurrence(metric: Metric, threshold: number): string {
  return `metric:${metric}:${threshold}`;
}

/** El resumen del disparador: «Puntos del programa llega a 500». */
export function metricSummary(c: MetricTriggerConfig): string {
  if (!isMetric(c.metric) || typeof c.threshold !== "number") return "Elegí la cifra y el número";
  return `${METRIC_LABELS[c.metric]} llega a ${c.threshold.toLocaleString("es-AR")}`;
}

/** Las variables del evento para el flujo: {{cifra.nombre}}, {{cifra.meta}}, {{cifra.valor}}. */
export const METRIC_VARIABLE_FIELDS = [
  { path: "cifra.nombre", label: "Qué cifra" },
  { path: "cifra.meta", label: "El número que alcanzó" },
  { path: "cifra.valor", label: "Cuánto tenía al llegar" },
] as const;

export function metricFlowVariables(payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const nombre = isMetric(p.metric) ? METRIC_LABELS[p.metric] : "";
  const meta = typeof p.threshold === "number" ? String(p.threshold) : "";
  const valor = typeof p.value === "number" ? String(p.value) : "";
  // Planas y anidadas, como las del servicio (el interpolador sigue el camino adentro del objeto).
  return { "cifra.nombre": nombre, "cifra.meta": meta, "cifra.valor": valor, cifra: { nombre, meta, valor } };
}
