/**
 * Los disparadores de punta a punta del lado del filtro: cada tipo del catálogo, con un evento de ejemplo como lo emite
 * la base o el código, (1) sin filtros arranca y (2) con un filtro que no coincide no arranca. Sumar un tipo sin su
 * ejemplo (o sin decir por qué se prueba en otro lado) hace fallar este test.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import "./index";
import { getTrigger } from "./registry";
import { TRIGGER_CATALOG } from "../trigger-catalog";
import { SERVICE_TRIGGER_TYPES } from "@/lib/services/automation";

type Fixture = {
  payload: Record<string, unknown>;
  /** Un filtro que este evento NO cumple. */
  miss: Record<string, unknown>;
  booking?: Record<string, unknown>;
  /** El disparador para el que va dirigido el evento (los relativos llevan su id). */
  triggerId?: string;
  flowId?: string;
};

// Los que no tienen filtro de evento (los arranca otra parte) o se prueban con su base en su módulo.
const ELSEWHERE: Record<string, string> = {
  keyword: "mensaje: trigger-matcher y keyword-match.test.ts",
  postback: "mensaje: triggers-characterization.test.ts",
  quick_reply: "mensaje: triggers-characterization.test.ts",
  welcome: "mensaje: sin filtro",
  default: "mensaje: sin filtro",
  comment_keyword: "comentario: comment-processor",
  email_received: "lo arranca el receptor de emails (lib/email/triggers.ts)",
  inactivity: "lo arranca el cron de inactividad",
  scheduled_time: "lo arranca su trabajo programado (lib/scheduled-flows)",
  webhook_received: "lo arranca el receptor de webhooks (lib/webhooks/run-flows.ts)",
  new_contact: "sin filtro: cualquier contacto nuevo",
  form_submitted: "lee la respuesta de la base: lib/forms/automation/triggers.test.ts",
  survey_answered: "lee la respuesta de la base: lib/forms/automation/triggers.test.ts",
  contract_signed: "lee la respuesta de la base: lib/forms/automation/triggers.test.ts",
};

const booking = { id: "b1", event_type_id: "et1", host_user_id: "u1", origin: "public_page", status: "scheduled", category_snapshot: { area_id: "a1", type_id: "t1" }, metadata: null };
const svc = { service_id: "s1", product_id: "p1", variant_id: "v1", service_status: "active" };
const sale = { sale_id: "sa1", product_id: "p1", variant_id: "v1", sale_status: "paid", final_amount: 100, change_id: "c1" };
const pay = { payment_id: "pa1", sale_id: "sa1", product_id: "p1", variant_id: "v1", sale_status: "paid", payment_type: "full", payment_method: "card", amount: 100, change_id: "c1" };
const task = { task_id: "t1", title: "Llamar", project: "Q4", project_key: "q4", status: "completed", source: "manual", priority: "high", due_date: "", completed_at: "" };
const call = { call_id: "c1", call_type: null, area_id: "a1", category_id: "k1", outcome: "won", closer_score: 80, lead_score: 70, lead_qualification: "hot", closer_id: "u1", booking_id: null };

const FIXTURES: Record<string, Fixture> = {
  crm_event: { payload: { tag_name: "vip" }, miss: { event: "tag_removed" } },
  booking_created: { payload: { booking_id: "b1" }, booking, miss: { origins: ["manual"] } },
  booking_rescheduled: { payload: { booking_id: "b1", by_whom: "invitee" }, booking, miss: { by_whom: ["host"] } },
  booking_cancelled: { payload: { booking_id: "b1", by_whom: "invitee" }, booking, miss: { host_user_ids: ["u9"] } },
  booking_updated: { payload: { booking_id: "b1" }, booking, miss: { event_type_ids: ["et9"] } },
  booking_ended: { payload: { booking_id: "b1" }, booking, miss: { category_ids: ["zz"] } },
  booking_status_changed: { payload: { booking_id: "b1", from_status: "scheduled", to_status: "sale" }, booking, miss: { to_status: ["no_show"] } },
  booking_before_start: { payload: { booking_id: "b1", trigger_id: "tr-1" }, booking, miss: { origins: ["manual"] } },
  booking_after_end: { payload: { booking_id: "b1", trigger_id: "tr-1" }, booking, miss: { origins: ["manual"] } },
  booking_after_created: { payload: { booking_id: "b1", trigger_id: "tr-1" }, booking, miss: { origins: ["manual"] } },
  call_analyzed: { payload: call, miss: { closer_ids: ["u9"] } },
  call_linked: { payload: call, miss: { area_ids: ["a9"] } },
  sale_created: { payload: sale, miss: { sale_statuses: ["reserved"] } },
  sale_status_changed: { payload: { ...sale, from_status: "pending_payment", to_status: "paid" }, miss: { variant_ids: ["v9"] } },
  payment_created: { payload: pay, miss: { variant_ids: ["v9"] } },
  payment_status_changed: { payload: { ...pay, from_status: "scheduled", to_status: "paid" }, miss: { sale_statuses: ["reserved"] } },
  payment_before_due: { payload: { ...pay, trigger_id: "tr-1" }, miss: { offset_days: 1, product_ids: ["p9"] } },
  payment_after_due: { payload: { ...pay, trigger_id: "tr-1" }, miss: { offset_days: 1, product_ids: ["p9"] } },
  affiliate_lead_created: { payload: { affiliate_type: "user", affiliate_id: "u1", affiliate_kind: "originated" }, miss: { affiliateId: "u9" } },
  affiliate_sale_created: { payload: { sale_id: "sa1", affiliate_type: "user", affiliate_id: "u1", affiliate_kind: "influenced" }, miss: { affiliateKind: "originated" } },
  affiliate_assignment_expired: { payload: { affiliate_type: "contact", affiliate_id: "c1", affiliate_kind: "originated" }, miss: { affiliateId: "c9" } },
  eod_submitted: { payload: { report_id: "r1", form_id: "f1", report_date: "2026-11-20", edit_count: 0 }, miss: { form_ids: ["f9"] } },
  task_completed: { payload: task, miss: { projects: ["otro"] } },
  task_overdue: { payload: { ...task, status: "open" }, miss: { sources: ["flow"] } },
  whatsapp_group_joined: { payload: { group_id: "g1", group_name: "Clase" }, miss: { group_ids: ["g9"] } },
  whatsapp_group_reaction: { payload: { group_id: "g1", emoji: "🔥", message_id: "m1", message_from_business: true }, miss: { emojis: ["❤️"] } },
  whatsapp_group_poll_vote: { payload: { group_id: "g1", message_id: "m1", selected_options_json: JSON.stringify(["Sí"]) }, miss: { options: ["No"] } },
  service_relative: { payload: { ...svc, trigger_id: "tr-1" }, miss: { variant_ids: ["v9"] } },
  service_phase_periodic: { payload: { ...svc, trigger_id: "tr-1" }, miss: { product_ids: ["p9"] } },
  service_metric_reached: { payload: { ...svc, flow_id: "flow-1", trigger_id: "tr-x" }, miss: { variant_ids: ["v9"] } },
  service_status_changed: { payload: { ...svc, service_status: "completed", previous_status: "active" }, miss: { to_statuses: ["paused"] } },
  service_light_changed: { payload: { ...svc, light: "red", previous_light: "green" }, miss: { lights: ["green"] } },
};
// El resto de Servicios: todos llevan producto y variante.
for (const type of SERVICE_TRIGGER_TYPES) FIXTURES[type] ??= { payload: svc, miss: { product_ids: ["p9"] } };

function argsFor(type: string, f: Fixture, config: Record<string, unknown>) {
  const db = memoryDb({ contacts: [{ id: "c-1", do_not_contact: false }] });
  return {
    supabase: db.client as never,
    event: { id: "ev-1", workspace_id: "ws", event_type: type, contact_id: "c-1", member_user_id: null, payload: f.payload },
    config,
    trigger: { id: f.triggerId ?? "tr-1", flow_id: f.flowId ?? "flow-1", channel_id: null, type, config, priority: 45, is_active: true },
    booking: f.booking ?? null,
  } as never;
}

describe("cada disparador del catálogo filtra bien", () => {
  const types = (TRIGGER_CATALOG as ReadonlyArray<{ type: string }>).map((e) => e.type);

  it("todos tienen un ejemplo o dicen dónde se prueban", () => {
    const missing = types.filter((t) => !FIXTURES[t] && !ELSEWHERE[t]);
    expect(missing, "disparadores sin ejemplo").toEqual([]);
  });

  for (const type of types) {
    const f = FIXTURES[type];
    if (!f) continue;
    it(`${type}: sin filtros arranca; con un filtro que no coincide, no`, async () => {
      const def = getTrigger(type);
      expect(def, `${type} no está registrado`).toBeTruthy();
      expect(def!.eventMatches, `${type} no tiene filtro de evento`).toBeTruthy();
      const base = type === "crm_event" ? { event: "tag_added" } : type.startsWith("payment_") && type.endsWith("_due") ? { offset_days: 1 } : {};
      const event = type === "crm_event" ? "tag_added" : type;
      const withType = (cfg: Record<string, unknown>) => {
        const a = argsFor(event, f, cfg) as { event: { event_type: string } };
        return a;
      };
      expect(await def!.eventMatches!(withType({ ...base }) as never), "sin filtros").toBe(true);
      expect(await def!.eventMatches!(withType({ ...base, ...f.miss }) as never), "con un filtro que no coincide").toBe(false);
    });
  }
});
