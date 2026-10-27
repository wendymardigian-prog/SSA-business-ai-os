/**
 * Procesar UN evento de `automation_events`: qué flujos le corresponden y arrancarlos. Lo usa
 * el cron (`app/api/cron/automation-events/route.ts`, que drena la cola) y `verify-eod`, que
 * prueba un evento puntual sin tocar el resto de la cola.
 */
import { executeFlow } from "@/lib/flow-engine/engine";
import { eventAllowsNoContact, eventSubject, getTrigger, triggerTypesForEvent } from "@/lib/flow-engine/registry";
import { bookingContextVariables } from "@/lib/scheduling/automation/context";
import { logAudit } from "@/lib/audit";
import type { createServiceClient } from "@/lib/supabase/server";
import type { TriggerType } from "@/lib/types/database";

export interface AutomationEvent {
  id: string;
  workspace_id: string;
  event_type: string;
  /** Null solo en un evento sin contacto (`eod_submitted`, 00182; origen propio, 00218). */
  contact_id: string | null;
  member_user_id: string | null;
  /** Que origino el evento (00218). La base lo completa para contacto y persona; un evento `system` lo trae explicito. */
  source_type?: string | null;
  source_id?: string | null;
  payload: Record<string, unknown>;
}

export type Db = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Dispara los flows que le corresponden a un evento. Devuelve cuantos arrancaron.
 *
 * Una rama EXPLICITA por sujeto (como con los proveedores, nunca un `else`): un evento
 * sobre un contacto sigue exactamente el camino de siempre; uno sobre una persona del
 * equipo va por el suyo, sin conversacion, canal ni "no contactar".
 */
export async function processEvent(supabase: Db, event: AutomationEvent): Promise<number> {
  // Un evento SIN contacto y con una persona del equipo, de un tipo que atiende tambien sin contacto, corre
  // por la rama de la persona. Con contacto (o cualquier otro evento) no cambia nada: sigue por `eventSubject`.
  if (!event.contact_id && event.member_user_id && eventAllowsNoContact(event.event_type)) {
    return processMemberEvent(supabase, event);
  }
  const subject = eventSubject(event.event_type);
  switch (subject) {
    case "contact":
      if (!event.contact_id) throw new Error(`el evento ${event.event_type} no trae contacto`);
      return processContactEvent(supabase, { ...event, contact_id: event.contact_id });
    case "member":
      return processMemberEvent(supabase, event);
    case "system":
      return processSystemEvent(supabase, event);
  }
}

/** Un evento sobre un contacto: el camino de siempre, sin cambios. */
async function processContactEvent(
  supabase: Db,
  event: AutomationEvent & { contact_id: string }
): Promise<number> {
  // Que tipos de trigger atienden este evento lo dice el registro, no un `if`
  // aca: sumar un tipo es declararlo con sus `eventTypes` y este archivo no se
  // toca. Un tipo que nombra el evento le gana al comodin `crm_event`.
  const types = triggerTypesForEvent(event.event_type) as TriggerType[];
  if (types.length === 0) return 0;

  const { data: triggers } = await supabase
    .from("triggers")
    .select("id, flow_id, channel_id, type, config, priority, is_active, flows!inner(status)")
    .eq("workspace_id", event.workspace_id)
    .in("type", types)
    .eq("is_active", true)
    .eq("flows.status", "published");

  if (!triggers || triggers.length === 0) return 0;

  // La conversacion mas reciente del contacto es por donde va a responder el
  // flow. Un contacto importado por CSV o que agendo desde la pagina publica
  // puede no tener ninguna: en ese caso el flow igual corre (puede poner tags,
  // mandar un email o cambiar el estado de la agenda), pero no va a poder
  // enviar por un canal.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, channel_id")
    .eq("contact_id", event.contact_id)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // La agenda del evento, una sola vez para todos los triggers: si cada uno la
  // consultara, un evento con diez flujos haria diez consultas iguales.
  const bookingId = typeof event.payload?.booking_id === "string" ? event.payload.booking_id : null;
  const booking = bookingId ? await loadBooking(supabase, bookingId) : null;
  const bookingVars = booking ? await bookingContextVariables(supabase, booking) : {};

  let fired = 0;
  const failures: string[] = [];

  for (const trigger of triggers) {
    const config = (trigger.config ?? {}) as Record<string, unknown>;
    const definition = getTrigger(trigger.type);
    if (!definition) continue;

    const args = {
      supabase,
      event,
      config,
      trigger: {
        id: trigger.id,
        flow_id: trigger.flow_id,
        channel_id: trigger.channel_id,
        type: trigger.type,
        config: trigger.config,
        priority: trigger.priority,
        is_active: trigger.is_active,
      },
      booking,
    };

    if (definition.eventMatches && !(await definition.eventMatches(args))) continue;

    // Idempotencia: el indice unico de trigger_fires es lo que decide. Si otra
    // corrida del cron ya lo disparo, el insert choca y no se ejecuta nada.
    const dedupeKey = definition.dedupeKeyFor ? definition.dedupeKeyFor(args) : `event:${event.id}`;

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
        `[cron/automation-events] el contacto ${event.contact_id} no tiene conversacion: el flow ${trigger.flow_id} no va a poder enviar por un canal`
      );
    }

    const extraVars = definition.variablesFor ? await definition.variablesFor(args) : {};

    // Un flujo que falla no se lleva puesto al resto de los disparadores de este evento (antes la excepcion cortaba el
    // ciclo y los demas no corrian nunca: el evento quedaba procesado). Se anota y se sigue; al final, si hubo fallos,
    // el evento queda con el motivo.
    try {
      await executeFlow(supabase, {
        triggerId: trigger.id,
        flowId: trigger.flow_id,
        channelId: conversation?.channel_id ?? "",
        contactId: event.contact_id,
        conversationId: conversation?.id ?? "",
        workspaceId: event.workspace_id,
        // Que disparo el flujo: lo declara el disparador (agenda, formulario, venta...) y el id es el del evento.
        source: { type: definition.sourceType ?? "contact", id: event.id },
        incomingMessage: {},
        variables: {
          // El flow puede leer el evento que lo disparo. Util para armar el
          // mensaje: "vi que te interesa {{event_value}}".
          event_type: event.event_type,
          ...Object.fromEntries(
            Object.entries(event.payload ?? {}).map(([k, v]) => [`event_${k}`, String(v ?? "")])
          ),
          ...bookingVars,
          ...extraVars,
        },
      });
    } catch (err) {
      failures.push(`${trigger.flow_id}: ${err instanceof Error ? err.message : "error desconocido"}`);
      continue;
    }

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

  throwIfFailures(failures, fired);
  return fired;
}

/** Si algun flujo fallo, el evento queda con el motivo (el cron lo guarda en `automation_events.error`). */
function throwIfFailures(failures: string[], fired: number): void {
  if (failures.length === 0) return;
  throw new Error(`${failures.length} flujo(s) fallaron (${fired} corrieron bien): ${failures.join("; ").slice(0, 500)}`);
}

/**
 * Un evento sobre una persona del equipo (E15): solo los disparadores `subject: "member"`
 * (nunca el comodin `crm_event`, que es de contactos) y los que atienden tambien eventos sin contacto.
 * El flujo arranca con `contactId: null` y `memberUserId`; no hay conversacion ni canal, y "no contactar"
 * no aplica porque no hay contacto.
 */
async function processMemberEvent(supabase: Db, event: AutomationEvent): Promise<number> {
  if (!event.member_user_id) throw new Error(`el evento ${event.event_type} no trae la persona del equipo`);
  return processNoContactEvent(supabase, event, { kind: "member", userId: event.member_user_id });
}

/**
 * Un evento sin contacto NI persona (Tiron 2, D1): solo los disparadores `subject: "system"`. El flujo arranca con `contactId: null` y sin persona; lo sostiene su origen (`source`), que la
 * base exige en lugar del contacto. Sin conversacion, canal ni "no contactar".
 */
async function processSystemEvent(supabase: Db, event: AutomationEvent): Promise<number> {
  return processNoContactEvent(supabase, event, { kind: "system" });
}

type NoContactSubject = { kind: "member"; userId: string } | { kind: "system" };

/** El ciclo de los eventos sin contacto: lo comparten el de una persona del equipo y el de sistema. */
async function processNoContactEvent(supabase: Db, event: AutomationEvent, who: NoContactSubject): Promise<number> {
  const types = (triggerTypesForEvent(event.event_type) as TriggerType[]).filter((type) => {
    const definition = getTrigger(type);
    // De persona: los `member` de siempre y los que atienden tambien eventos sin contacto.
    // De sistema: solo los declarados `system` (un evento sin contacto ni persona sigue sin correr: no se emite).
    return who.kind === "member" ? definition?.subject === "member" || definition?.contactOptional === true : definition?.subject === "system";
  });
  if (types.length === 0) return 0;

  const { data: triggers } = await supabase
    .from("triggers")
    .select("id, flow_id, channel_id, type, config, priority, is_active, flows!inner(status)")
    .eq("workspace_id", event.workspace_id)
    .in("type", types)
    .eq("is_active", true)
    .eq("flows.status", "published");
  if (!triggers || triggers.length === 0) return 0;

  let fired = 0;
  const failures: string[] = [];
  for (const trigger of triggers) {
    const config = (trigger.config ?? {}) as Record<string, unknown>;
    const definition = getTrigger(trigger.type);
    if (!definition) continue;
    const args = {
      supabase,
      event,
      config,
      trigger: {
        id: trigger.id,
        flow_id: trigger.flow_id,
        channel_id: trigger.channel_id,
        type: trigger.type,
        config: trigger.config,
        priority: trigger.priority,
        is_active: trigger.is_active,
      },
      booking: null,
    };

    if (definition.eventMatches && !(await definition.eventMatches(args))) continue;

    const dedupeKey = definition.dedupeKeyFor ? definition.dedupeKeyFor(args) : `event:${event.id}`;
    const { error: claimError } = await supabase.from("trigger_fires").insert({
      trigger_id: trigger.id,
      workspace_id: event.workspace_id,
      dedupe_key: dedupeKey,
      contact_id: null,
    });
    if (claimError) {
      if (claimError.code !== "23505") console.error("[cron/automation-events] no pude reclamar el disparo:", claimError.message);
      continue;
    }

    const extraVars = definition.variablesFor ? await definition.variablesFor(args) : {};
    try {
      await executeFlow(supabase, {
        triggerId: trigger.id,
        flowId: trigger.flow_id,
        channelId: "",
        contactId: null,
        ...(who.kind === "member" ? { memberUserId: who.userId } : {}),
        conversationId: "",
        workspaceId: event.workspace_id,
        // Que disparo el flujo: lo declara el disparador; el id es el del evento (su payload trae lo demas).
        source: { type: definition.sourceType ?? (who.kind === "member" ? "member" : "system"), id: event.id },
        incomingMessage: {},
        variables: {
          event_type: event.event_type,
          ...Object.fromEntries(Object.entries(event.payload ?? {}).map(([k, v]) => [`event_${k}`, String(v ?? "")])),
          ...extraVars,
        },
      });
    } catch (err) {
      failures.push(`${trigger.flow_id}: ${err instanceof Error ? err.message : "error desconocido"}`);
      continue;
    }

    // @plantilla-desde(formularios)
    // El disparo queda en el historial de lo que lo origino (el reporte), no de un contacto.
    const audited = definition.auditEntityFor?.(args) ?? null;
    if (audited) {
      await logAudit({
        supabase,
        workspaceId: event.workspace_id,
        entityType: audited.entityType,
        entityId: audited.entityId,
        action: "automation_triggered",
        metadata: { trigger_id: trigger.id, flow_id: trigger.flow_id, event_type: event.event_type, ...(audited.metadata ?? {}) },
      });
    }
    // @plantilla-hasta(formularios)
    fired++;
  }
  throwIfFailures(failures, fired);
  return fired;
}

/** La agenda del evento, si el payload la nombra. */
async function loadBooking(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  bookingId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}
