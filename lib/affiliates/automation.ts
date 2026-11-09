// @plantilla-quitar(ventas)
/**
 * Los disparadores de afiliados (F72, F74): reglas puras. Los tres son de CONTACTO y viajan por la cola
 * `automation_events`; los emite la base (00343) con escalares: el tipo y el id del afiliado y su tipo de asignación
 * (y la venta en `affiliate_sale_created`). Nunca `booking_id`.
 */
export const AFFILIATE_TRIGGER_TYPES = ["affiliate_lead_created", "affiliate_sale_created", "affiliate_assignment_expired"] as const;
export type AffiliateTriggerType = (typeof AFFILIATE_TRIGGER_TYPES)[number];

export const AFFILIATE_TRIGGER_LABELS: Record<AffiliateTriggerType, string> = {
  affiliate_lead_created: "Un afiliado trajo un lead",
  affiliate_sale_created: "Venta de un afiliado",
  affiliate_assignment_expired: "Venció la asignación de un afiliado",
};

/** El filtro del disparador: un afiliado (persona del equipo o contacto) y/o un tipo de asignación. Vacío = todos. */
export interface AffiliateTriggerConfig {
  affiliateId?: string | null;
  affiliateKind?: "originated" | "influenced" | null;
}

export function affiliateEventMatches(config: unknown, payload: unknown): boolean {
  const c = (config && typeof config === "object" ? config : {}) as AffiliateTriggerConfig;
  const p = (payload && typeof payload === "object" ? payload : {}) as { affiliate_id?: unknown; affiliate_kind?: unknown };
  if (c.affiliateId && p.affiliate_id !== c.affiliateId) return false;
  if (c.affiliateKind && p.affiliate_kind !== c.affiliateKind) return false;
  return true;
}

export function affiliateDedupeKey(type: AffiliateTriggerType, eventId: string): string {
  return `${type}:${eventId}`;
}

export function affiliateVariables(payload: unknown): Record<string, string> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    "affiliate.type": str(p.affiliate_type) === "user" ? "equipo" : str(p.affiliate_type) === "contact" ? "externo" : "",
    "affiliate.kind": str(p.affiliate_kind) === "originated" ? "lo trajo" : str(p.affiliate_kind) === "influenced" ? "influyó" : "",
    "affiliate.sale_id": str(p.sale_id),
  };
}
