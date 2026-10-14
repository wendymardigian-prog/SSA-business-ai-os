import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { processEvent, type AutomationEvent } from "@/lib/flow-engine/automation-events";

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

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();

  const { data: events, error } = await supabase
    .from("automation_events")
    .select("id, workspace_id, event_type, contact_id, member_user_id, source_type, source_id, payload")
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
