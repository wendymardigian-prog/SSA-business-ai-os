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

import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { sendTransactionalEmail } from "@/lib/email/send";
import { computeQuota } from "@/lib/email/quota";
import { createNotification } from "@/lib/notifications/create";
import { resolveBankVariables } from "@/lib/response-assets/bank-variables";
import { BOOKING_TRIGGER_SCOPE } from "@/lib/scheduling/automation/context";

export interface SendEmailNodeData {
  /**
   * A dónde va: el contacto, el anfitrión de la reunión o una dirección fija. En un flujo
   * sin contacto (E15): `member` (la persona que envió el reporte) o `users` (personas
   * del equipo elegidas); ahí no se ofrece "al contacto".
   */
  to?: "contact" | "host" | "fixed" | "member" | "users" | "variable";
  fixedEmail?: string;
  /**
   * Solo `to: "variable"` (Tirón 2, D4): la dirección sale de una variable del flujo, por ejemplo
   * `{{webhook.body.email}}` (también se acepta sin las llaves). No necesita contacto.
   */
  toVariable?: string;
  /** Solo `to: "users"`: a quiénes del equipo. */
  userIds?: string[];
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

async function execute({ supabase, data, context, node }: NodeExecutionArgs<SendEmailNodeData, FlowExecutionContext>) {
  const interpolated = {
    subject: interpolateVariables(data.subject ?? "", context.variables ?? {}).trim(),
    body: interpolateVariables(data.body ?? "", context.variables ?? {}).trim(),
  };
  // Un texto de la banca insertado en el email trae sus variables
  // ({{contact.display_name}}...): las que quedaron sin resolver se completan
  // con los datos reales (lib/response-assets/bank-variables.ts). Sin contacto
  // (un flujo sobre una persona del equipo) no hay con qué completarlas.
  const contactId = context.contactId;
  const [subject, body] = (
    contactId
      ? await resolveBankVariables(supabase, { workspaceId: context.workspaceId, contactId, variables: context.variables }, [interpolated.subject, interpolated.body])
      : [interpolated.subject, interpolated.body]
  ).map((text) => text.trim());
  if (!subject && !body) return;

  let contactEmail: string | null = null;
  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, do_not_contact")
      .eq("id", contactId)
      .maybeSingle();

    // Un flujo de agenda manda igual: es una reunión que la persona pidió.
    const fromBooking = context.variables?.trigger_scope === BOOKING_TRIGGER_SCOPE;
    if (contact?.do_not_contact && !fromBooking) {
      console.warn(`[flow-engine] el contacto ${contactId} está marcado "no contactar": no se manda el email del nodo ${node.id}`);
      return;
    }
    contactEmail = contact?.email ?? null;
  }
  // Sin contacto no hay "no contactar" que mirar: el email va a gente del equipo o a una dirección fija.

  let recipients: string[];
  if (data.to === "variable") {
    // Tirón 2, D4: la dirección sale de una variable. Si no sirve, el paso se saltea CON el motivo (no falla).
    const resolved = await variableRecipient(supabase, data, context);
    if (!resolved.ok) {
      console.warn(`[flow-engine] el nodo ${node.id} (send_email) se saltea: ${resolved.reason}`);
      try {
        await supabase.from("analytics_events").insert({
          workspace_id: context.workspaceId,
          flow_id: context.flowId,
          contact_id: contactId,
          event_type: "node_skipped",
          metadata: { nodeId: node.id, nodeType: "send_email", reason: resolved.reason },
        });
        context.onStepSkipped?.({ nodeId: node.id, nodeType: "send_email", label: "Enviar email" });
      } catch {
        // Anotar el salto nunca frena el flujo.
      }
      return;
    }
    recipients = [resolved.address];
  } else {
    recipients = await resolveRecipients(supabase, data, context, contactEmail);
  }
  if (recipients.length === 0) {
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

  for (const to of recipients) {
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
      contactId,
      deps: { supabase },
    });
  }
}

/** Los emails de personas del equipo: solo de quienes son miembros del workspace. */
async function teamEmails(supabase: NodeExecutionArgs<SendEmailNodeData>["supabase"], workspaceId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.rpc("workspace_member_profiles", { p_workspace_id: workspaceId });
  if (error || !data) {
    console.error(`[flow-engine] no pude leer los emails del equipo (code=${error?.code ?? "?"})`);
    return [];
  }
  const wanted = new Set(userIds);
  return data.filter((m) => wanted.has(m.user_id) && m.email).map((m) => m.email as string);
}

/** A quiénes va: el contacto, el anfitrión, una dirección fija, o personas del equipo. */
async function resolveRecipients(
  supabase: NodeExecutionArgs<SendEmailNodeData>["supabase"],
  data: SendEmailNodeData,
  context: FlowExecutionContext,
  contactEmail: string | null,
): Promise<string[]> {
  const mode = data.to ?? "contact";
  switch (mode) {
    case "member":
      return context.memberUserId ? teamEmails(supabase, context.workspaceId, [context.memberUserId]) : [];
    case "users":
      return teamEmails(supabase, context.workspaceId, [...new Set(data.userIds ?? [])]);
    case "variable":
      // Lo resuelve `execute` (necesita el motivo para anotar el salto); acá no llega.
      return [];
    case "contact":
    case "host":
    case "fixed": {
      const one = await resolveRecipient(supabase, data, context, contactEmail);
      return one ? [one] : [];
    }
  }
}

/** Una dirección de email razonable (la misma regla que usan las pantallas de automatizaciones). */
export const EMAIL_ADDRESS_RE = /^[^\s@,;()<>"]+@[^\s@,;()<>"]+\.[^\s@,;()<>"]+$/;

/**
 * La dirección de una variable (Tirón 2, D4). Se valida al correr: si no es un email, el paso se saltea con el motivo
 * (no falla). Si la dirección es de un contacto marcado «no contactar», no se manda; un error de la base al comprobarlo
 * NO se toma como «no es de nadie».
 */
async function variableRecipient(
  supabase: NodeExecutionArgs<SendEmailNodeData>["supabase"],
  data: SendEmailNodeData,
  context: FlowExecutionContext,
): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  const template = (data.toVariable ?? "").trim();
  if (!template) return { ok: false, reason: "No elegiste de qué variable sale la dirección." };
  const wrapped = /\{\{[^}]+\}\}/.test(template) ? template : `{{${template}}}`;
  const address = interpolateVariables(wrapped, context.variables ?? {}).trim();
  if (!address) return { ok: false, reason: "La variable de la dirección está vacía." };
  if (address.length > 254 || !EMAIL_ADDRESS_RE.test(address)) return { ok: false, reason: "La variable de la dirección no tiene un email válido." };

  // El valor va como VALOR de un filtro (nunca armando una cadena de filtros), y se mira el email principal y el segundo.
  const escaped = address.replace(/[%_\\]/g, (c) => `\\${c}`);
  const base = () => supabase.from("contacts").select("id, do_not_contact").eq("workspace_id", context.workspaceId).is("deleted_at", null).limit(5);
  const [byEmail, bySecondary] = await Promise.all([base().ilike("email", escaped), base().ilike("secondary_email", escaped)]);
  const failed = byEmail.error ?? bySecondary.error;
  if (failed) {
    console.error(`[flow-engine] no pude comprobar si la dirección es de un contacto "no contactar" (code=${failed.code ?? "?"})`);
    return { ok: false, reason: "No pude comprobar si la dirección es de un contacto marcado «no contactar», así que no se mandó." };
  }
  if ([...(byEmail.data ?? []), ...(bySecondary.data ?? [])].some((c) => c.do_not_contact)) {
    return { ok: false, reason: "La dirección es de un contacto marcado «no contactar»: no se mandó." };
  }
  return { ok: true, address };
}

/** A dónde va el email: el contacto, el anfitrión de la reunión o una dirección fija. */
async function resolveRecipient(
  supabase: NodeExecutionArgs<SendEmailNodeData, FlowExecutionContext>["supabase"],
  data: SendEmailNodeData,
  context: NodeExecutionArgs<SendEmailNodeData, FlowExecutionContext>["context"],
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
  needsContact: false,
  type: "send_email",
  label: "Enviar email",
  aliases: [{ nodeType: "action", actionType: "send_email" }],
  execute,
};
