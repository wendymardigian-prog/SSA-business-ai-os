import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { executeFlow } from "@/lib/flow-engine/engine";

/**
 * GET /api/cron/inactivity
 *
 * Dispara los flows de inactividad (F5): pasaron X horas sin que el lead
 * conteste y hay algo que decirle.
 *
 * Es el trigger que recupera leads que se quedaron a mitad de camino, que es
 * justamente el problema que este sistema viene a resolver.
 *
 * Como se decide que una conversacion esta inactiva: por
 * contacts.last_interaction_at, que es cuando el lead interactuo por ultima
 * vez. No sirve mirar la tabla `messages`, porque los mensajes entrantes de
 * Instagram no se guardan localmente y el conteo daria siempre cero.
 *
 * Se dispara una sola vez por conversacion y por ventana. Lo garantiza el
 * indice unico de trigger_fires con una clave que incluye la ventana: dos
 * corridas del cron en paralelo chocan en la base, no en la logica.
 *
 * Solo se evaluan canales con acceso a respuestas (hoy Instagram; WhatsApp
 * cuando se conecte). Un canal donde no se puede saber si el lead contesto no
 * puede tener trigger de inactividad.
 */

/** Cuantas conversaciones se evaluan por corrida, para no colgar el cron. */
const BATCH = 200;

interface InactivityConfig {
  /** Ventana de inactividad. */
  amount?: number;
  unit?: "hours" | "days";
}

/** Canales donde se puede saber si el lead respondio. */
const CHANNELS_WITH_REPLIES = ["instagram", "facebook", "whatsapp"] as const;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    request.nextUrl.searchParams.get("key") ||
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!cronSecret || provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const { data: triggers, error } = await supabase
    .from("triggers")
    .select("id, flow_id, channel_id, config, workspace_id, flows!inner(status)")
    .eq("type", "inactivity")
    .eq("is_active", true)
    .eq("flows.status", "published");

  if (error) {
    console.error("[cron/inactivity] no pude leer los triggers:", error.message);
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }

  if (!triggers || triggers.length === 0) {
    return NextResponse.json({ ok: true, triggers: 0, fired: 0 });
  }

  let fired = 0;

  for (const trigger of triggers) {
    const config = (trigger.config ?? {}) as InactivityConfig;
    const hours = windowHours(config);
    if (!hours) {
      console.warn(`[cron/inactivity] el trigger ${trigger.id} no tiene ventana configurada`);
      continue;
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Conversaciones abiertas del workspace cuyo contacto no interactua desde
    // antes del corte. La automatizacion pausada se respeta: si alguien tomo la
    // conversacion a mano, el bot no se mete.
    let query = supabase
      .from("conversations")
      .select("id, channel_id, contact_id, platform, contacts!inner(last_interaction_at, do_not_contact, is_subscribed)")
      .eq("workspace_id", trigger.workspace_id)
      .eq("status", "open")
      .is("deleted_at", null)
      .eq("is_automation_paused", false)
      .in("platform", CHANNELS_WITH_REPLIES)
      .lt("contacts.last_interaction_at", cutoff)
      .eq("contacts.do_not_contact", false)
      .eq("contacts.is_subscribed", true)
      .limit(BATCH);

    // Un trigger puede acotarse a un canal; sin channel_id vale para todos.
    if (trigger.channel_id) {
      query = query.eq("channel_id", trigger.channel_id);
    }

    const { data: conversations, error: convError } = await query;

    if (convError) {
      console.error("[cron/inactivity] no pude leer conversaciones:", convError.message);
      continue;
    }

    for (const conversation of conversations ?? []) {
      // La clave lleva la ventana: si el trigger se reconfigura de 24h a 72h,
      // vuelve a poder disparar sobre la misma conversacion, que es lo esperado.
      const dedupeKey = `conv:${conversation.id}:${hours}h`;

      const { error: claimError } = await supabase.from("trigger_fires").insert({
        trigger_id: trigger.id,
        workspace_id: trigger.workspace_id,
        dedupe_key: dedupeKey,
        contact_id: conversation.contact_id,
      });

      if (claimError) {
        // 23505 = ya se disparo en esta ventana. Es el caso normal: el cron
        // corre cada quince minutos y la conversacion sigue inactiva.
        if (claimError.code !== "23505") {
          console.error("[cron/inactivity] no pude reclamar el disparo:", claimError.message);
        }
        continue;
      }

      try {
        await executeFlow(supabase, {
          triggerId: trigger.id,
          flowId: trigger.flow_id,
          channelId: conversation.channel_id,
          contactId: conversation.contact_id,
          conversationId: conversation.id,
          workspaceId: trigger.workspace_id,
          incomingMessage: {},
          variables: { inactivity_hours: String(hours) },
        });
        fired++;
      } catch (err) {
        console.error(
          `[cron/inactivity] el flow ${trigger.flow_id} fallo en la conversacion ${conversation.id}:`,
          err instanceof Error ? err.message : "error desconocido"
        );
      }
    }
  }

  return NextResponse.json({ ok: true, triggers: triggers.length, fired });
}

/** Pasa la ventana configurada a horas. Devuelve null si no es valida. */
export function windowHours(config: InactivityConfig): number | null {
  const amount = Number(config.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return config.unit === "days" ? amount * 24 : amount;
}
