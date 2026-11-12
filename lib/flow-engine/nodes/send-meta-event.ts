/**
 * «Enviar evento a Meta» (00328): le avisa a la API de Conversiones de Meta que pasó algo que vale (un lead, una
 * reunión agendada...). Se arma desde el editor de pasos o en el lienzo.
 *
 * El paso NO manda en el momento: anota el evento y lo encola (`lib/meta/capi/run.ts`), y el flujo sigue. Un fallo de
 * Meta nunca frena el flujo; se reintenta solo y el resultado se ve en la tarjeta de la API de Conversiones.
 *
 * Lo que decide solo, sin que la persona lo configure:
 *   - De qué se trata: lo que disparó el flujo (por ejemplo la reunión), o (en cualquier otro disparador)
 *     solo el contacto.
 *   - El código del evento: el que usó el Pixel de la web (`meta_event_id`) o uno fijo por respuesta, reunión o paso.
 *     Así un reintento, o el mismo flujo corriendo dos veces, no cuenta doble.
 *   - La hora: la de la respuesta o la reunión, no la de cuando corre el paso (después de un «Esperar» de días, Meta
 *     ya no lo acepta y se saltea con su motivo).
 *
 * Necesita contacto (`needsContact`): sin la persona no hay con qué cruzar el evento.
 */

import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { checkStepEventName, isCurrencyCode, SEND_META_EVENT_TYPE, type MetaEventStepData } from "@/lib/meta/capi/events";
import { CAPI_MAX_AGE_DAYS, capiEventId, parseMoney, SKIP_REASON_LABELS } from "@/lib/meta/capi/build-event";
import { enqueueCapiEvent, type CapiEnqueueInput } from "@/lib/meta/capi/run";
import type { Json } from "@/lib/types/database";

const LEAD_BOOKING_ORIGINS = new Set(["public_page", "embed"]);
const MAX_AGE_MS = CAPI_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const field = (v: unknown, key: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined);

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<MetaEventStepData>): Promise<void> {
  const skip = (reason: string): void => {
    console.warn(`[flow-engine] el nodo ${node.id} (${SEND_META_EVENT_TYPE}) se saltea: ${reason}`);
    context.noteStep?.({ status: "skipped", reason });
  };

  const name = checkStepEventName(data.eventName);
  if (!name.ok) return skip(name.error);

  const vars = context.variables ?? {};
  const bookingId = text(vars.event_booking_id);

  const valueText = interpolateVariables(String(data.value ?? ""), vars).trim();
  const value = valueText ? parseMoney(valueText) : null;
  const params: Record<string, Json> = {};
  if (value !== null) {
    params.value = value;
    params.currency = isCurrencyCode(data.currency) ? data.currency : "USD";
  }
  const contentName =
    interpolateVariables(String(data.contentName ?? ""), vars).trim() || text(field(vars.form, "name")) || text(field(vars.booking, "event_title"));
  if (contentName) params.content_name = contentName.slice(0, 200);

  const base = { workspaceId: context.workspaceId, eventName: name.name, flowId: context.flowId, flowSessionId: sessionId, params };
  let input: CapiEnqueueInput | null = null;

  // @plantilla-desde(formularios)
  const submissionId = text(field(vars.submission, "id")) ?? text(vars.event_submission_id);
  if (submissionId) {
    const { data: sub, error } = await supabase
      .from("form_submissions")
      .select("id, created_at, meta, status")
      .eq("id", submissionId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (error) {
      context.noteStep?.({ status: "failed", reason: "No pude leer la respuesta del formulario." });
      return;
    }
    if (!sub) return skip(SKIP_REASON_LABELS.source_missing);
    if (sub.status === "spam") return skip(SKIP_REASON_LABELS.spam);
    input = {
      ...base,
      eventId: capiEventId({ type: "form", submissionId: sub.id, metaEventId: text(field(sub.meta, "meta_event_id")) }),
      sourceType: "form",
      sourceId: sub.id,
      eventTime: sub.created_at,
    };
  }
  // @plantilla-hasta(formularios)

  if (!input && bookingId) {
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id, created_at, origin")
      .eq("id", bookingId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (error) {
      context.noteStep?.({ status: "failed", reason: "No pude leer la reunión." });
      return;
    }
    if (!booking) return skip(SKIP_REASON_LABELS.source_missing);
    if (data.onlyLeadBookings !== false && !LEAD_BOOKING_ORIGINS.has(String(booking.origin ?? ""))) return skip(SKIP_REASON_LABELS.not_lead_booking);
    input = { ...base, eventId: capiEventId({ type: "booking", bookingId: booking.id }), sourceType: "booking", sourceId: booking.id, eventTime: booking.created_at };
  }

  if (!input) {
    input = {
      ...base,
      eventId: capiEventId({ type: "flow", sessionId, nodeId: node.id }),
      sourceType: "contact",
      sourceId: context.contactId,
      eventTime: new Date().toISOString(),
    };
  }

  if (Date.now() - Date.parse(input.eventTime) > MAX_AGE_MS) return skip(SKIP_REASON_LABELS.too_old);

  const queued = await enqueueCapiEvent(supabase, input);
  if (queued.ok) return;
  if (queued.reason === "duplicate") return skip(queued.message);
  context.noteStep?.({ status: "failed", reason: queued.message });
}

export const sendMetaEventNode: NodeDefinition<MetaEventStepData> = {
  needsContact: true,
  requires: ["meta_capi"],
  type: SEND_META_EVENT_TYPE,
  label: "Enviar evento a Meta",
  aliases: [{ nodeType: "action", actionType: SEND_META_EVENT_TYPE }],
  execute,
};
