/**
 * Los seis triggers de Ventas en el registro (plano F37): `sale_created`, `sale_status_changed`,
 * `payment_created`, `payment_status_changed`, `payment_before_due` y `payment_after_due`.
 *
 * Acá solo se declaran: qué evento atiende cada uno, cómo se filtra y cuál es su clave de idempotencia.
 * Las reglas viven en `lib/sales/automation/triggers.ts`, puras y con sus tests. El cron
 * `automation-events` no se toca.
 *
 * UN FLUJO CORRE UNA VEZ POR CAMBIO aunque tenga dos triggers que coincidan (el genérico «Cambió el
 * estado del pago» y el atajo «Pago cobrado»; o «Pago creado» + «Pago cobrado» sobre un pago que nace
 * cobrado, que comparten `change_id`). Cada trigger tiene su propia clave de idempotencia, así que eso se
 * decide acá, en `eventMatches`: se arman todos los pares (trigger activo del MISMO flujo, evento con el
 * mismo `change_id`) que coinciden y solo el menor `(prioridad, trigger.id, evento.id)` devuelve `true`
 * (`pickCanonicalTrigger`). Es determinista: no depende del orden en que el cron procese los eventos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerTrigger } from "./registry";
import type { TriggerEventArgs } from "./types";
import {
  EVENT_TYPES_OF,
  isRelativeSalesTrigger,
  pickCanonicalTrigger,
  SALES_TRIGGER_LABELS,
  SALES_TRIGGER_TYPES,
  salesDedupeKey,
  salesEventMatches,
  type CanonicalCandidate,
  type SalesTriggerType,
} from "@/lib/sales/automation/triggers";
import { salesVariables } from "@/lib/sales/automation/variables";
import { salesVariableSchema } from "@/lib/sales/automation/variable-schema";

type Db = SupabaseClient<Database>;

/** Los tipos de venta que NO son relativos: los que comparten `change_id` entre sí. */
const IMMEDIATE_TYPES = SALES_TRIGGER_TYPES.filter((t) => !isRelativeSalesTrigger(t));

/** ¿Este par (trigger, evento) es el canónico de su flujo para ese cambio? */
async function isCanonicalPair(args: TriggerEventArgs): Promise<boolean> {
  const changeId = args.event.payload?.change_id;
  if (typeof changeId !== "string" || !changeId) return true;
  const db = args.supabase as Db;

  const [{ data: siblings, error: siblingsError }, { data: events, error: eventsError }] = await Promise.all([
    db
      .from("triggers")
      .select("id, type, config, priority")
      .eq("flow_id", args.trigger.flow_id)
      .eq("workspace_id", args.event.workspace_id)
      .eq("is_active", true)
      .in("type", [...IMMEDIATE_TYPES]),
    db
      .from("automation_events")
      .select("id, event_type, payload")
      .eq("workspace_id", args.event.workspace_id)
      .eq("payload->>change_id", changeId)
      .in("event_type", [...IMMEDIATE_TYPES]),
  ]);
  // Si no se puede decidir, se deja pasar: el índice de `trigger_fires` igual evita el doble disparo de UN mismo trigger.
  if (siblingsError || eventsError) return true;

  const candidates: CanonicalCandidate[] = [];
  for (const trigger of siblings ?? []) {
    for (const event of events ?? []) {
      if (!EVENT_TYPES_OF[trigger.type as SalesTriggerType]?.includes(event.event_type)) continue;
      if (!salesEventMatches(trigger.type, trigger.config, (event.payload ?? {}) as Record<string, unknown>, trigger.id)) continue;
      candidates.push({ triggerId: trigger.id, priority: trigger.priority ?? 0, eventId: event.id });
    }
  }
  const winner = pickCanonicalTrigger(candidates);
  // Sin candidatos (el propio par ya no se ve) se deja pasar: nunca se pierde un disparo por un hueco.
  return !winner || (winner.triggerId === args.trigger.id && winner.eventId === args.event.id);
}

/** Las variables `{{sale.*}}` y `{{payment.*}}` del evento. */
async function loadVariables(args: TriggerEventArgs): Promise<Record<string, unknown>> {
  const db = args.supabase as Db;
  const payload = (args.event.payload ?? {}) as Record<string, unknown>;
  const saleId = typeof payload.sale_id === "string" ? payload.sale_id : "";
  const paymentId = typeof payload.payment_id === "string" ? payload.payment_id : "";
  if (!saleId && !paymentId) return {};

  const [{ data: payment }] = paymentId
    ? [await db.from("payments").select("id, sale_id, amount, due_date, payment_method, status, delay_days").eq("id", paymentId).maybeSingle()]
    : [{ data: null }];
  const resolvedSaleId = saleId || payment?.sale_id || "";
  const [{ data: sale }, { data: salePayments }] = resolvedSaleId
    ? await Promise.all([
        db.from("sales").select("id, status, final_amount, product_snapshot, attribution, attribution_type, vendedor_id, setter_id").eq("id", resolvedSaleId).maybeSingle(),
        db.from("payments").select("amount, status").eq("sale_id", resolvedSaleId),
      ])
    : [{ data: null }, { data: null }];

  // Los nombres del equipo, solo si hace falta (import dinámico: usa el cliente de servicio).
  let names: Record<string, string> = {};
  if (sale?.vendedor_id || sale?.setter_id) {
    try {
      const { getWorkspaceMembers } = await import("@/lib/workspace-members");
      names = Object.fromEntries((await getWorkspaceMembers(args.event.workspace_id)).map((m) => [m.userId, m.name]));
    } catch (error) {
      console.error("[ventas] no pude leer los nombres del equipo:", error instanceof Error ? error.message : "error");
    }
  }
  // El contacto de la venta, para `{{contact.first_name}}` (R3).
  let contact: { display_name: string | null } | null = null;
  if (args.event.contact_id) {
    const { data } = await db.from("contacts").select("display_name").eq("id", args.event.contact_id).eq("workspace_id", args.event.workspace_id).maybeSingle();
    contact = (data as { display_name: string | null } | null) ?? null;
  }
  return { ...salesVariables({ sale: sale ?? null, salePayments: salePayments ?? undefined, payment: payment ?? null, event: payload, names, contact }) };
}

for (const type of SALES_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: SALES_TRIGGER_LABELS[type],
    // Los dos relativos los agenda un job (como los de agenda); el resto nace de la cola de eventos.
    scope: isRelativeSalesTrigger(type) ? "scheduled" : "event",
    // Debajo de `crm_event` (50), igual que agenda, llamadas y formularios.
    priority: 45,
    eventTypes: EVENT_TYPES_OF[type],

    // Lo que un camino condicional puede comparar de la venta o el pago (solo texto: ver el modulo).
    variableSchema: () => salesVariableSchema(type),

    eventMatches: async (args) => {
      const payload = (args.event.payload ?? {}) as Record<string, unknown>;
      if (!salesEventMatches(type, args.config, payload, args.trigger.id)) return false;
      // Un relativo lo emite el job de SU trigger: no compite con otros.
      if (isRelativeSalesTrigger(type)) return true;
      return isCanonicalPair(args);
    },

    dedupeKeyFor: (args) => salesDedupeKey(type, (args.event.payload ?? {}) as Record<string, unknown>, args.event.id, args.trigger.id),

    variablesFor: loadVariables,
  });
}
