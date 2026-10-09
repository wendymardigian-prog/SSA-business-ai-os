/**
 * Mandar un email desde un flow (F46).
 *
 * Es el nodo que hace posibles los flujos de agenda: la confirmación, el
 * recordatorio y el seguimiento son emails, no mensajes de canal (quien
 * agenda desde la página pública no tiene conversación).
 *
 * Tres reglas propias de este nodo:
 *  - Respeta "no contactar", SALVO cuando el flow arrancó por un trigger de
 *    agenda: la confirmación de una reunión que la persona pidió no es una
 *    comunicación comercial, y no mandarla la deja sin el link.
 *  - Sin dirección de destino no falla: se saltea y queda anotado.
 *  - Con la cuota diaria de Resend agotada NO manda y avisa: mandar igual
 *    haría que el proveedor rechace y el email se pierda sin rastro.
 */

import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { sendTransactionalEmail } from "@/lib/email/send";
import { computeQuota } from "@/lib/email/quota";
import { createNotification } from "@/lib/notifications/create";
import { resolveBankVariables } from "@/lib/response-assets/bank-variables";
import { BOOKING_TRIGGER_SCOPE } from "@/lib/scheduling/automation/context";

export interface SendEmailNodeData {
  /** A dónde va: el contacto, el anfitrión de la reunión o una dirección fija. */
  to?: "contact" | "host" | "fixed";
  fixedEmail?: string;
  subject?: string;
  /** Cuerpo con variables (`{{booking.start_invitee}}`). Texto plano o HTML. */
  body?: string;
}

/** El texto plano se vuelve HTML respetando los saltos de línea. */
export function bodyToHtml(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
}

async function execute({ supabase, data, context, node }: NodeExecutionArgs<SendEmailNodeData>) {
  const interpolated = {
    subject: interpolateVariables(data.subject ?? "", context.variables ?? {}).trim(),
    body: interpolateVariables(data.body ?? "", context.variables ?? {}).trim(),
  };
  // Un texto de la banca insertado en el email trae sus variables
  // ({{contact.display_name}}...): las que quedaron sin resolver se completan
  // con los datos reales (lib/response-assets/bank-variables.ts).
  const [subject, body] = (
    await resolveBankVariables(supabase, { workspaceId: context.workspaceId, contactId: context.contactId }, [interpolated.subject, interpolated.body])
  ).map((text) => text.trim());
  if (!subject && !body) return;

  const { data: contact } = await supabase
    .from("contacts")
    .select("email, do_not_contact")
    .eq("id", context.contactId)
    .maybeSingle();

  // Un flujo de agenda manda igual: es una reunión que la persona pidió.
  const fromBooking = context.variables?.trigger_scope === BOOKING_TRIGGER_SCOPE;
  if (contact?.do_not_contact && !fromBooking) {
    console.warn(`[flow-engine] el contacto ${context.contactId} está marcado "no contactar": no se manda el email del nodo ${node.id}`);
    return;
  }

  const to = await resolveRecipient(supabase, data, context, contact?.email ?? null);
  if (!to) {
    console.warn(`[flow-engine] el nodo ${node.id} no tiene a dónde mandar el email`);
    return;
  }

  // La cuota del día. `computeQuota` cuenta entrada y salida, como el plan.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await supabase
    .from("email_log")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", context.workspaceId)
    .eq("status", "sent")
    .gte("created_at", since.toISOString());

  const quota = computeQuota({ sentToday: sentToday ?? 0, receivedToday: 0 });
  if (quota.exhausted) {
    console.error(`[flow-engine] cuota de email agotada: no sale el email del nodo ${node.id}`);
    await createNotification({
      supabase,
      workspaceId: context.workspaceId,
      type: "email_quota_reached",
      title: "Se agotó la cuota de emails de hoy",
      body: `${quota.label} Un flujo intentó mandar un email y no salió.`,
      entityType: "flow",
      entityId: context.flowId,
      metadata: { flow_id: context.flowId, node_id: node.id },
    });
    return;
  }

  await sendTransactionalEmail({
    workspaceId: context.workspaceId,
    to,
    subject: subject || "(sin asunto)",
    html: bodyToHtml(body),
    // `flow` lo distingue de los transaccionales del sistema y de la prueba
    // que manda el editor (`flow_test`), que no cuenta como envío al contacto.
    kind: "flow",
    relatedEntityType: "flow",
    relatedEntityId: context.flowId,
    // Para que el email aparezca en el historial del contacto (00135), vaya a
    // quien vaya: el contacto, el anfitrion o una direccion fija.
    contactId: context.contactId,
    deps: { supabase },
  });
}

/** A dónde va el email: el contacto, el anfitrión de la reunión o una dirección fija. */
async function resolveRecipient(
  supabase: NodeExecutionArgs<SendEmailNodeData>["supabase"],
  data: SendEmailNodeData,
  context: NodeExecutionArgs<SendEmailNodeData>["context"],
  contactEmail: string | null,
): Promise<string | null> {
  const mode = data.to ?? "contact";
  if (mode === "fixed") return data.fixedEmail?.trim() || null;
  if (mode === "contact") return contactEmail;

  // El anfitrión de la agenda que disparó el flow.
  const bookingId = context.variables?.event_booking_id;
  if (typeof bookingId !== "string" || !bookingId) return null;
  const { data: booking } = await supabase.from("bookings").select("host_user_id").eq("id", bookingId).maybeSingle();
  if (!booking) return null;
  const { data: profile } = await supabase
    .from("scheduling_profiles")
    .select("public_email")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", booking.host_user_id)
    .maybeSingle();
  return (profile as { public_email?: string | null } | null)?.public_email ?? null;
}

export const sendEmailNode: NodeDefinition<SendEmailNodeData> = {
  type: "send_email",
  label: "Enviar email",
  aliases: [{ nodeType: "action", actionType: "send_email" }],
  execute,
};
