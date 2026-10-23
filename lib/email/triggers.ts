/**
 * El trigger "email recibido" en los flows (F67).
 *
 * Un flow que arranca cuando entra un correo: sirve para avisar por
 * WhatsApp que llego una consulta, o para etiquetar al contacto.
 *
 * El filtro por asunto es opcional y es lo que hace util al trigger: sin
 * el, cualquier flow con este trigger correria con cada correo que entre,
 * incluidos los que no tienen nada que ver.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { ChannelRow } from "@/lib/inbound";

type Db = SupabaseClient<Database>;

export const EMAIL_TRIGGER = "email_received";

export interface EmailTriggerConfig {
  /** Solo si el asunto contiene esto. Vacio = cualquier asunto. */
  subjectContains?: string | null;
}

/** Si ese correo dispara ese trigger. */
export function emailMatches(
  config: EmailTriggerConfig,
  email: { subject: string | null },
): boolean {
  const needle = (config.subjectContains ?? "").trim().toLowerCase();
  if (!needle) return true;
  return (email.subject ?? "").toLowerCase().includes(needle);
}

/**
 * Arranca los flows con trigger de email que corresponden.
 *
 * Best-effort: un flow que falla no puede hacer que se pierda el correo,
 * que ya esta guardado antes de llegar aca.
 */
export async function runEmailTriggers(
  supabase: Db,
  params: {
    channel: ChannelRow;
    contactId: string;
    conversationId: string;
    subject: string | null;
    text: string;
    /** El id del correo: con el, un mismo correo no dispara dos veces el mismo flujo (reentregas de Resend). */
    emailId?: string | null;
  },
): Promise<number> {
  // Igual que un mensaje de chat: un contacto marcado «no contactar» o una conversacion que alguien tomo a mano no
  // arrancan automatizaciones (antes el email las arrancaba igual, aun despues de pedir la baja).
  const [{ data: contact }, { data: conversation }] = await Promise.all([
    supabase.from("contacts").select("do_not_contact").eq("id", params.contactId).maybeSingle(),
    supabase.from("conversations").select("is_automation_paused").eq("id", params.conversationId).maybeSingle(),
  ]);
  if ((contact as { do_not_contact?: boolean } | null)?.do_not_contact) return 0;
  if ((conversation as { is_automation_paused?: boolean } | null)?.is_automation_paused) return 0;

  const { data: triggers } = await supabase
    .from("triggers")
    .select("id, flow_id, config")
    .eq("workspace_id", params.channel.workspace_id)
    .eq("type", EMAIL_TRIGGER)
    .eq("is_active", true);

  if (!triggers || triggers.length === 0) return 0;

  const matching = triggers.filter((trigger) =>
    emailMatches((trigger.config ?? {}) as EmailTriggerConfig, { subject: params.subject }),
  );

  if (matching.length === 0) return 0;

  const { executeFlow } = await import("@/lib/flow-engine/engine");
  let started = 0;

  for (const trigger of matching) {
    if (params.emailId) {
      const { error: claimError } = await supabase.from("trigger_fires").insert({
        trigger_id: trigger.id,
        workspace_id: params.channel.workspace_id,
        dedupe_key: `email:${params.emailId}`,
        contact_id: params.contactId,
      });
      if (claimError) {
        if (claimError.code !== "23505") console.error("[email] no pude reclamar el disparo:", claimError.message);
        continue;
      }
    }
    try {
      await executeFlow(supabase, {
        triggerId: trigger.id,
        flowId: trigger.flow_id,
        channelId: params.channel.id,
        contactId: params.contactId,
        conversationId: params.conversationId,
        workspaceId: params.channel.workspace_id,
        lateAccountId: params.channel.late_account_id,
        incomingMessage: { text: params.text || params.subject || "" },
        // El asunto queda disponible como variable del flow: es lo que
        // alguien va a querer usar en el aviso que manda.
        variables: { email_subject: params.subject ?? "" },
      });
      started += 1;
    } catch (err) {
      console.error(`[email] no pude arrancar el flow ${trigger.flow_id}:`, err);
    }
  }

  return started;
}
