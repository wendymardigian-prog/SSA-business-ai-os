/**
 * A qué servicio queda unida una reunión (Servicios A4, F135; decisión 481). PURA.
 *
 * Gemela de `app_servicio.svc_call_link_plan(jsonb)` (00367). Los casos de `call-link.cases.json` corren contra las
 * dos (vitest y `verify-services --bloque a4`). Si se cambia una regla, se cambia en las dos y se suma el caso.
 *
 * El enganche de `calls` junta los datos (contacto, área, tipo, la agenda y su `utm.svc_item`, los servicios del
 * contacto) y esta función decide:
 *   0. Lo vinculado a mano (`manual`) no se toca.
 *   1. Sin contacto, de otra área que no sea Servicio, o de tipo Clase → sin servicio y sin intento.
 *   2. La agenda trae el `svc_item` de un paso de un servicio DE ESE CONTACTO → ese servicio (`booking`).
 *   3. Los servicios del contacto no cancelados cuyo período cubre la fecha de la reunión (o pendientes de
 *      confirmar):
 *      - uno solo → `auto`;
 *      - varios → gana el único cuya variante tiene un paso Reunión con el tipo de reunión de la agenda (`auto`);
 *      - si siguen varios → «Por revisar» (`review`, sin servicio). Nunca se adivina;
 *      - ninguno → sin servicio y sin intento.
 */

export type CallServiceLink = "auto" | "booking" | "manual" | "review";

export type CallLinkCandidate = {
  id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  /** Los tipos de reunión de los pasos Reunión del camino de su variante. */
  booking_event_type_ids: string[];
};

export type CallLinkInput = {
  /** El vínculo que ya tiene la reunión. `manual` no se toca. */
  current_link: CallServiceLink | null;
  has_contact: boolean;
  /** `booking_categories.system_key` del área de la reunión, o null. */
  area_key: string | null;
  /** `booking_categories.system_key` del tipo, o null. */
  type_key: string | null;
  /** El servicio (de este contacto) del paso que trae la agenda en `utm.svc_item`, o null. */
  booking_item_service_id: string | null;
  /** La fecha de la reunión (YYYY-MM-DD, en la zona del negocio). */
  recorded_on: string;
  /** El tipo de reunión de la agenda vinculada, o null. */
  event_type_id: string | null;
  candidates: CallLinkCandidate[];
};

export type CallLinkPlan = { action: "keep" } | { action: "set"; service_id: string | null; link: CallServiceLink | null };

export const SERVICE_AREA_KEY = "servicio";
export const CLASS_TYPE_KEY = "servicio.clase";

/** Si la reunión es del área Servicio y no es una clase (las únicas que se vinculan solas, decisión 481). */
export function isServiceMeeting(areaKey: string | null, typeKey: string | null): boolean {
  if (typeKey === CLASS_TYPE_KEY) return false;
  return areaKey === SERVICE_AREA_KEY || (typeKey !== null && typeKey.startsWith(`${SERVICE_AREA_KEY}.`));
}

function covers(c: CallLinkCandidate, day: string): boolean {
  if (c.status === "cancelled") return false;
  if (c.status === "pending_confirmation") return true;
  if (c.starts_on && c.starts_on > day) return false;
  if (c.ends_on && day > c.ends_on) return false;
  return true;
}

export function callLinkPlan(input: CallLinkInput): CallLinkPlan {
  if (input.current_link === "manual") return { action: "keep" };
  if (!input.has_contact || !isServiceMeeting(input.area_key, input.type_key)) {
    return { action: "set", service_id: null, link: null };
  }
  if (input.booking_item_service_id) {
    return { action: "set", service_id: input.booking_item_service_id, link: "booking" };
  }
  const covering = input.candidates.filter((c) => covers(c, input.recorded_on));
  if (covering.length === 1) return { action: "set", service_id: covering[0].id, link: "auto" };
  if (covering.length === 0) return { action: "set", service_id: null, link: null };
  if (input.event_type_id) {
    const byType = covering.filter((c) => c.booking_event_type_ids.includes(input.event_type_id!));
    if (byType.length === 1) return { action: "set", service_id: byType[0].id, link: "auto" };
  }
  return { action: "set", service_id: null, link: "review" };
}
