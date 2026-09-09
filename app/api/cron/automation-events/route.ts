import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { executeFlow } from "@/lib/flow-engine/engine";
import { crmEventMatches } from "@/lib/flow-engine/registry/triggers";
import { logAudit } from "@/lib/audit";

/**
 * GET /api/cron/automation-events
 *
 * Autenticacion: header `Authorization: Bearer <CRON_SECRET>`. La query string
 * `?key=` ya no autoriza (un secreto en la URL queda en los logs del proxy y en
 * la tabla de pg_net). Lo manda asi private.call_app_cron, migracion 00036.
 *
 * Drena la cola de eventos del CRM y dispara los flows que correspondan
 * (F3: contacto nuevo, F4: evento de CRM).
 *
 * Los eventos los escriben triggers de Postgres (migracion 00039), que es lo
 * que garantiza que no se escape ninguno: un contacto se crea por tres caminos
 * distintos y los tags se agregan desde cuatro lugares. Aca solo se leen.
 *
 * Por que no dispara la base directamente: el motor de flows manda mensajes,
 * llama a la IA y habla con APIs externas. Nada de eso se puede hacer desde una
 * funcion de Postgres, y si el disparo fuera sincronico un flow lento frenaria
 * el guardado del contacto.
 *
 * Corre cada minuto: un contacto nuevo que tiene que recibir una bienvenida no
 * puede esperar un cuarto de hora.
 */

/** Cuantos eventos se procesan por corrida. */
const BATCH = 50;

interface AutomationEvent {
  id: string;
  workspace_id: string;
  event_type: string;
  contact_id: string;
  payload: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();

  const { data: events, error } = await supabase
    .from("automation_events")
    .select("id, workspace_id, event_type, contact_id, payload")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[cron/automation-events] no pude leer la cola:", error.message);
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }

  if (!events || events.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let fired = 0;
  for (const event of events as AutomationEvent[]) {
    try {
      fired += await processEvent(supabase, event);
      await supabase
        .from("automation_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", event.id);
    } catch (err) {
      // Un evento que falla no puede frenar a los demas. Se marca procesado con
      // el motivo: reintentarlo eternamente tampoco sirve, y asi queda la traza.
      const detail = err instanceof Error ? err.message : "error desconocido";
      console.error(`[cron/automation-events] evento ${event.id} fallo:`, detail);
      await supabase
        .from("automation_events")
        .update({ processed_at: new Date().toISOString(), error: detail })
        .eq("id", event.id);
    }
  }

  return NextResponse.json({ ok: true, processed: events.length, fired });
}

/** Dispara los flows que le corresponden a un evento. Devuelve cuantos arrancaron. */
async function processEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  event: AutomationEvent
): Promise<number> {
  // "contacto nuevo" tiene su propio tipo de trigger; el resto son crm_event.
  const triggerType = event.event_type === "contact_created" ? "new_contact" : "crm_event";

  const { data: triggers } = await supabase
    .from("triggers")
    .select("id, flow_id, config, flows!inner(status)")
    .eq("workspace_id", event.workspace_id)
    .eq("type", triggerType)
    .eq("is_active", true)
    .eq("flows.status", "published");

  if (!triggers || triggers.length === 0) return 0;

  // La conversacion mas reciente del contacto es por donde va a responder el
  // flow. Un contacto importado por CSV puede no tener ninguna: en ese caso el
  // flow igual corre (puede poner tags o campos), pero no va a poder enviar.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, channel_id")
    .eq("contact_id", event.contact_id)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  let fired = 0;

  for (const trigger of triggers) {
    const config = (trigger.config ?? {}) as Record<string, unknown>;

    if (triggerType === "crm_event" && !crmEventMatches(config, event)) continue;

    // Idempotencia: el indice unico de trigger_fires es lo que decide. Si otra
    // corrida del cron ya lo disparo, el insert choca y no se ejecuta nada.
    // Para "contacto nuevo" la clave es el contacto, asi que dispara una sola
    // vez en la vida del contacto aunque el evento se repita.
    const dedupeKey =
      triggerType === "new_contact" ? `contact:${event.contact_id}` : `event:${event.id}`;

    const { error: claimError } = await supabase.from("trigger_fires").insert({
      trigger_id: trigger.id,
      workspace_id: event.workspace_id,
      dedupe_key: dedupeKey,
      contact_id: event.contact_id,
    });

    if (claimError) {
      // 23505 = ya se disparo. Es el caso normal, no un error.
      if (claimError.code !== "23505") {
        console.error("[cron/automation-events] no pude reclamar el disparo:", claimError.message);
      }
      continue;
    }

    if (!conversation) {
      console.warn(
        `[cron/automation-events] el contacto ${event.contact_id} no tiene conversacion: el flow ${trigger.flow_id} no va a poder enviar`
      );
    }

    await executeFlow(supabase, {
      triggerId: trigger.id,
      flowId: trigger.flow_id,
      channelId: conversation?.channel_id ?? "",
      contactId: event.contact_id,
      conversationId: conversation?.id ?? "",
      workspaceId: event.workspace_id,
      incomingMessage: {},
      variables: {
        // El flow puede leer el evento que lo disparo. Util para armar el
        // mensaje: "vi que te interesa {{event_value}}".
        event_type: event.event_type,
        ...Object.fromEntries(
          Object.entries(event.payload ?? {}).map(([k, v]) => [`event_${k}`, String(v ?? "")])
        ),
      },
    });

    // El requerimiento pide que el disparo quede en el registro de auditoria.
    await logAudit({
      supabase,
      workspaceId: event.workspace_id,
      entityType: "contact",
      entityId: event.contact_id,
      action: "automation_triggered",
      metadata: {
        trigger_id: trigger.id,
        flow_id: trigger.flow_id,
        event_type: event.event_type,
      },
    });

    fired++;
  }

  return fired;
}
