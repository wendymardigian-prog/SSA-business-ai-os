/**
 * Los 7 flujos sugeridos que se crean, APAGADOS, con cada evento (F49).
 *
 * Un flujo es un flow normal del flow builder: mismas tablas, mismos nodos.
 * Lo unico propio es `flows.event_type_id` (a que evento pertenece) y
 * `flows.template_key` (cual de las 7 es).
 *
 * "Apagado" = `flows.status = 'draft'`. La fila de `triggers` recien se
 * escribe al publicar, que es lo que hace el switch de F48: asi un flujo
 * apagado no puede disparar por accidente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

export type TemplateKey =
  | "confirmation"
  | "reminder_24h"
  | "reminder_1h"
  | "rescheduled"
  | "cancelled"
  | "no_show"
  | "thank_you";

export interface FlowTemplate {
  key: TemplateKey;
  /** Como se llama, despues del titulo del evento. */
  name: string;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  /** En lenguaje simple, para la lista de F48. */
  describe: string;
  subject?: string;
  body: string;
  /** Ademas del email, manda por WhatsApp si el contacto tiene telefono. */
  alsoWhatsapp?: boolean;
  /** Minutos de espera antes de enviar (nodo Delay). */
  delayHours?: number;
}

/**
 * Los textos, en español rioplatense. Se pueden editar como cualquier flow.
 * Las variables son las de F47.
 */
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "confirmation",
    name: "Confirmación con tu marca",
    trigger: { type: "booking_created", config: {} },
    describe: "Se crea la agenda · Email al contacto",
    subject: "Confirmamos tu reunión: {{booking.event_title}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Tu reunión quedó agendada para el {{booking.start_invitee}}.\n\n" +
      "Dónde: {{booking.location}}\n" +
      "Link de la videollamada: {{booking.meet_url}}\n\n" +
      "¿Necesitás cambiarla?\n" +
      "Reagendar: {{booking.reschedule_url}}\n" +
      "Cancelar: {{booking.cancel_url}}\n\n" +
      "Nos vemos,\n{{booking.host_name}}",
  },
  {
    key: "reminder_24h",
    name: "Recordatorio 24 h antes",
    trigger: { type: "booking_before_start", config: { offset_minutes: 1440 } },
    describe: "24 horas antes de la agenda · Email al contacto",
    subject: "Mañana: {{booking.event_title}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Te recuerdo nuestra reunión: {{booking.start_invitee}}.\n\n" +
      "Link: {{booking.meet_url}}\n\n" +
      "Si no llegás a tiempo, podés reagendar acá: {{booking.reschedule_url}}\n\n" +
      "{{booking.host_name}}",
  },
  {
    key: "reminder_1h",
    name: "Recordatorio 1 h antes",
    trigger: { type: "booking_before_start", config: { offset_minutes: 60 } },
    describe: "1 hora antes de la agenda · Email + WhatsApp al contacto",
    subject: "En una hora: {{booking.event_title}}",
    body:
      "Hola {{contact.first_name}}, en una hora tenemos la reunión ({{booking.time_invitee}}).\n\n" +
      "Link: {{booking.meet_url}}\n\n" +
      "{{booking.host_name}}",
    alsoWhatsapp: true,
  },
  {
    key: "rescheduled",
    name: "Aviso de reagendamiento",
    trigger: { type: "booking_rescheduled", config: {} },
    describe: "Se reagenda · Email al contacto",
    subject: "Nueva fecha: {{booking.event_title}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Tu reunión quedó para el {{booking.start_invitee}}.\n\n" +
      "Link: {{booking.meet_url}}\n\n" +
      "{{booking.host_name}}",
  },
  {
    key: "cancelled",
    name: "Aviso de cancelación",
    trigger: { type: "booking_cancelled", config: { by_whom: "any" } },
    describe: "Se cancela · Email al contacto con link para volver a agendar",
    subject: "Cancelamos: {{booking.event_title}}",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Tu reunión del {{booking.start_invitee}} quedó cancelada.\n\n" +
      "Cuando quieras retomar, agendá de nuevo acá: {{scheduling.link}}\n\n" +
      "{{booking.host_name}}",
  },
  {
    key: "no_show",
    name: "Seguimiento de no-show",
    trigger: { type: "booking_status_changed", config: { to_status: ["no_show"] } },
    describe: "Cambia el estado a No-show · Email con link de reagendar",
    subject: "¿Reagendamos?",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Te esperamos en la reunión de {{booking.start_invitee}} y no pudimos encontrarnos. " +
      "Si te sirve, elegí otro horario acá: {{booking.reschedule_url}}\n\n" +
      "{{booking.host_name}}",
  },
  {
    key: "thank_you",
    name: "Agradecimiento",
    trigger: {
      type: "booking_status_changed",
      config: { to_status: ["followup_warm", "followup_cold", "sale", "not_qualified"] },
    },
    describe: "Cambia el estado a cualquier resultado · Espera 2 h · Email al contacto",
    subject: "Gracias por tu tiempo",
    body:
      "Hola {{contact.first_name}},\n\n" +
      "Gracias por la charla de hoy. Cualquier cosa que necesites, respondé este mail.\n\n" +
      "{{booking.host_name}}",
    delayHours: 2,
  },
];

export function templateByKey(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((t) => t.key === key);
}

/** El nombre del flujo en la lista: "[Título del evento] · <plantilla>". */
export function flowNameFor(eventTitle: string, template: FlowTemplate): string {
  return `${eventTitle} · ${template.name}`.slice(0, 120);
}

interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * El grafo de una plantilla: el nodo trigger, la espera si la hay, el email y
 * el WhatsApp opcional. Es el mismo formato que guarda el canvas, asi que el
 * flujo se puede abrir y editar en el flow builder.
 */
export function templateGraph(template: FlowTemplate, eventTypeId: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        triggerType: template.trigger.type,
        // El filtro por evento: este flujo aplica solo a su evento (F49).
        config: { ...template.trigger.config, event_type_ids: [eventTypeId] },
        ...template.trigger.config,
        event_type_ids: [eventTypeId],
      },
    },
  ];
  const edges: CanvasEdge[] = [];
  let previous = "trigger";
  let y = 160;

  if (template.delayHours) {
    nodes.push({
      id: "delay",
      type: "delay",
      position: { x: 0, y },
      data: { duration: template.delayHours, unit: "hours" },
    });
    edges.push({ id: `${previous}-delay`, source: previous, target: "delay" });
    previous = "delay";
    y += 160;
  }

  nodes.push({
    id: "email",
    type: "action",
    position: { x: 0, y },
    data: {
      // El alias exacto del registro (lib/flow-engine/nodes/send-email.ts).
      // Con otro nombre el motor no resuelve el nodo y el email no sale, sin
      // que nada avise: hay un test que compara esto con el registro.
      actionType: "send_email",
      to: "contact",
      subject: template.subject ?? "",
      body: template.body,
    },
  });
  edges.push({ id: `${previous}-email`, source: previous, target: "email" });
  previous = "email";
  y += 160;

  if (template.alsoWhatsapp) {
    nodes.push({
      id: "whatsapp",
      type: "sendMessage",
      position: { x: 0, y },
      data: { messages: [{ text: template.body }], onlyIfPhone: true },
    });
    edges.push({ id: `${previous}-whatsapp`, source: previous, target: "whatsapp" });
  }

  return { nodes, edges };
}

/**
 * Crea los 7 flujos de un evento, apagados. Devuelve cuantos creo.
 *
 * Si ya existen (duplicar un evento dos veces, reintento), no los repite:
 * la clave es `(event_type_id, template_key)`.
 */
export async function createEventFlows(
  supabase: SupabaseClient<Database>,
  input: { workspaceId: string; eventTypeId: string; eventTitle: string },
): Promise<number> {
  const { data: existing } = await supabase
    .from("flows")
    .select("template_key")
    .eq("event_type_id", input.eventTypeId);
  const already = new Set((existing ?? []).map((f) => (f as { template_key?: string | null }).template_key).filter(Boolean));

  const rows = FLOW_TEMPLATES.filter((t) => !already.has(t.key)).map((template) => {
    const graph = templateGraph(template, input.eventTypeId);
    return {
      workspace_id: input.workspaceId,
      name: flowNameFor(input.eventTitle, template),
      description: template.describe,
      // Apagado: el switch de F48 lo publica.
      status: "draft" as const,
      nodes: graph.nodes as unknown as Json,
      edges: graph.edges as unknown as Json,
      event_type_id: input.eventTypeId,
      template_key: template.key,
    };
  });
  if (rows.length === 0) return 0;

  const { error, count } = await supabase.from("flows").insert(rows, { count: "exact" });
  if (error) {
    console.error("[agenda] no pude crear los flujos sugeridos:", error.message);
    return 0;
  }
  return count ?? rows.length;
}
