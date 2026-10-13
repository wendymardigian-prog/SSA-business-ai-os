/**
 * El disparador "Se envió un reporte de fin de día" (E16): su configuración, cuándo
 * dispara y su clave de idempotencia. PURO.
 *
 *   { form_ids: string[] (vacío = cualquier EOD), on: "first" | "every" }
 *
 * `first` (por defecto) = solo el primer envío del día; `every` = también cada corrección.
 * La clave `eod:<report_id>:<edit_count>` hace que una corrección no dispare dos veces.
 */
export type EodTriggerOn = "first" | "every";

export interface EodTriggerConfig {
  form_ids: string[];
  on: EodTriggerOn;
}

export interface EodEventPayload {
  report_id: string;
  form_id: string;
  report_date: string;
  edit_count: number;
}

export function parseEodTriggerConfig(config: unknown): EodTriggerConfig {
  const raw = (config ?? {}) as { form_ids?: unknown; on?: unknown };
  const formIds = Array.isArray(raw.form_ids) ? raw.form_ids.filter((id): id is string => typeof id === "string") : [];
  return { form_ids: formIds, on: raw.on === "every" ? "every" : "first" };
}

export function parseEodPayload(payload: unknown): EodEventPayload | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.report_id !== "string" || typeof p.form_id !== "string") return null;
  const editCount = Number(p.edit_count ?? 0);
  return { report_id: p.report_id, form_id: p.form_id, report_date: String(p.report_date ?? ""), edit_count: Number.isFinite(editCount) ? editCount : 0 };
}

export function eodEventMatches(config: unknown, payload: unknown): boolean {
  const parsed = parseEodPayload(payload);
  if (!parsed) return false;
  const c = parseEodTriggerConfig(config);
  if (c.form_ids.length > 0 && !c.form_ids.includes(parsed.form_id)) return false;
  return c.on === "every" || parsed.edit_count === 0;
}

export function eodDedupeKey(payload: unknown, fallbackEventId: string): string {
  const parsed = parseEodPayload(payload);
  return parsed ? `eod:${parsed.report_id}:${parsed.edit_count}` : `event:${fallbackEventId}`;
}

/** "Se envía un reporte de fin de día en «EOD Setters» (solo el primer envío del día)". */
export function describeEodTrigger(config: unknown, formNames: Record<string, string> = {}): string {
  const c = parseEodTriggerConfig(config);
  const where = c.form_ids.length > 0 ? `en ${c.form_ids.map((id) => `«${formNames[id] ?? "reporte"}»`).join(" o ")}` : "en cualquier reporte de fin de día";
  const when = c.on === "every" ? "cada envío y cada corrección" : "solo el primer envío del día";
  return `Se envía un reporte de fin de día ${where} (${when})`;
}
