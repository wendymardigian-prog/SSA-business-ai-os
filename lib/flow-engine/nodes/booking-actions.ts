/**
 * Las dos acciones de agenda que un flow puede hacer (F46).
 *
 * `cancel_booking` cancela la reunión que disparó el flow; `set_booking_status`
 * le cambia el estado. Las dos pasan por las MISMAS funciones que usa el
 * equipo desde la pantalla, así el evento de Google, los avisos y el historial
 * quedan igual de completos que si lo hubiera hecho una persona.
 *
 * La agenda sale del contexto (`event_booking_id`), no de la configuración del
 * nodo: un flow de agenda trabaja sobre la reunión que lo disparó.
 */

import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { cancelBooking, type CancelStatus } from "@/lib/scheduling/booking/cancel";
import { isBookingStatus, groupOf, evaluateTransition, TRANSITION_REASON_TEXT } from "@/lib/scheduling/booking-status";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";

export interface CancelBookingNodeData {
  /** Uno de los tres estados de cancelación. */
  status?: CancelStatus;
  reason?: string;
}

export interface SetBookingStatusNodeData {
  status?: string;
}

/** La agenda sobre la que trabaja el flow: la que lo disparó. */
function bookingIdOf(context: NodeExecutionArgs<unknown>["context"]): string | null {
  const id = context.variables?.event_booking_id;
  return typeof id === "string" && id ? id : null;
}

export const cancelBookingNode: NodeDefinition<CancelBookingNodeData> = {
  type: "cancel_booking",
  label: "Cancelar la reunión",
  aliases: [{ nodeType: "action", actionType: "cancel_booking" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<CancelBookingNodeData>) {
    const bookingId = bookingIdOf(context);
    if (!bookingId) {
      console.warn(`[flow-engine] el nodo ${node.id} quiere cancelar una reunión y el flow no arrancó por una`);
      return;
    }
    const result = await cancelBooking(supabase, {
      bookingId,
      by: "system",
      status: data.status ?? "cancelled_other",
      reason: data.reason ?? "Cancelada por una automatización",
    });
    if (!result.ok) {
      console.warn(`[flow-engine] no pude cancelar la reunión ${bookingId}: ${result.reason}`);
    }
  },
};

export const setBookingStatusNode: NodeDefinition<SetBookingStatusNodeData> = {
  type: "set_booking_status",
  label: "Cambiar el estado de la reunión",
  aliases: [{ nodeType: "action", actionType: "set_booking_status" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<SetBookingStatusNodeData>) {
    const bookingId = bookingIdOf(context);
    const status = data.status;
    if (!bookingId || !isBookingStatus(status)) {
      console.warn(`[flow-engine] el nodo ${node.id} no puede cambiar el estado: falta la reunión o el estado no existe`);
      return;
    }

    // Cancelar es otra cosa: borra el evento de Google y anula los avisos.
    if (groupOf(status) === "cancelled") {
      await cancelBookingNode.execute({ supabase, data: { status: status as CancelStatus }, context, node } as never);
      return;
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, workspace_id, status, start_at, contact_id, event_type_id, host_user_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return;

    const now = new Date();
    const verdict = evaluateTransition(booking.status, status, booking, now);
    if (!verdict.ok) {
      console.warn(
        `[flow-engine] no se puede pasar de ${booking.status} a ${status}: ${verdict.reason ? TRANSITION_REASON_TEXT[verdict.reason] : "no permitido"}`,
      );
      return;
    }

    await supabase
      .from("bookings")
      .update({ status, status_changed_at: now.toISOString(), status_changed_by: null })
      .eq("id", booking.id);

    await logAudit({
      supabase,
      workspaceId: booking.workspace_id,
      entityType: "booking",
      entityId: booking.id,
      action: "booking.status_changed",
      changes: { status: { old: booking.status, new: status } },
      metadata: { by: "flow", flow_id: context.flowId, node_id: node.id },
    });

    await supabase.from("automation_events").insert({
      workspace_id: booking.workspace_id,
      event_type: "booking_status_changed",
      contact_id: booking.contact_id,
      payload: {
        booking_id: booking.id,
        event_type_id: booking.event_type_id,
        host_user_id: booking.host_user_id,
        from_status: booking.status,
        to_status: status,
        by_whom: "system",
      } as unknown as Json,
    });
  },
};
