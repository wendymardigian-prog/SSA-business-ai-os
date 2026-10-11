/**
 * Los triggers de Llamadas en el registro (F32): la idempotencia y los filtros
 * tal como los usa el cron `automation-events`.
 */
import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import "./index";
import { getTrigger, triggerTypesForEvent } from "./registry";
import type { TriggerEventArgs } from "./types";

const event = (type: string, payload: Record<string, unknown>, id = "ev-1") => ({ id, workspace_id: "ws1", event_type: type, contact_id: "ct1", payload });
const args = (type: string, payload: Record<string, unknown>, config: Record<string, unknown> = {}, evId = "ev-1"): TriggerEventArgs =>
  ({ supabase: fakeDb().client, event: event(type, payload, evId), config, trigger: { id: "t1" } as never }) as unknown as TriggerEventArgs;
const payload = (over: Record<string, unknown> = {}) => ({
  call_id: "c1",
  call_type: "cierre",
  outcome: "seguimiento_con_fecha",
  closer_score: 70,
  lead_score: 62,
  lead_qualification: "con_reservas",
  closer_id: "u1",
  booking_id: null,
  analysis_run_id: "run-1",
  ...over,
});

describe("el registro atiende los eventos de llamada", () => {
  it("cada evento lo atiende su trigger", () => {
    expect(triggerTypesForEvent("call_analyzed")).toContain("call_analyzed");
    expect(triggerTypesForEvent("call_linked")).toContain("call_linked");
  });
});

describe("call_analyzed", () => {
  const def = () => getTrigger("call_analyzed")!;

  it("con outcomes: ['venta'] NO inicia con un seguimiento_con_fecha", async () => {
    expect(await def().eventMatches!(args("call_analyzed", payload(), { outcomes: ["venta"] }))).toBe(false);
  });
  it("con lead_score_min: 60 y una llamada con 62, SI inicia", async () => {
    expect(await def().eventMatches!(args("call_analyzed", payload(), { lead_score_min: 60 }))).toBe(true);
  });
  it("procesar dos veces el mismo evento da la MISMA clave de idempotencia (el flujo inicia una vez)", () => {
    const a = def().dedupeKeyFor!(args("call_analyzed", payload()));
    const b = def().dedupeKeyFor!(args("call_analyzed", payload(), {}, "ev-2"));
    expect(a).toBe("call:c1:call_analyzed:run-1");
    expect(b).toBe(a);
  });
  it("un analisis regenerado (otra corrida) tiene otra clave y vuelve a disparar", () => {
    expect(def().dedupeKeyFor!(args("call_analyzed", payload({ analysis_run_id: "run-2" })))).toBe("call:c1:call_analyzed:run-2");
  });
  it("sin analysis_run_id cae al id del evento (nunca una clave compartida)", () => {
    expect(def().dedupeKeyFor!(args("call_analyzed", payload({ analysis_run_id: undefined }), {}, "ev-9"))).toBe("call:c1:call_analyzed:ev-9");
  });
});

describe("call_linked", () => {
  const def = () => getTrigger("call_linked")!;
  it("la clave lleva el contacto vinculado", () => {
    expect(def().dedupeKeyFor!(args("call_linked", payload()))).toBe("call:c1:call_linked:ct1");
  });
  it("filtra por tipo de llamada y closer, no por resultado", async () => {
    expect(await def().eventMatches!(args("call_linked", payload(), { call_types: ["triaje"] }))).toBe(false);
    expect(await def().eventMatches!(args("call_linked", payload(), { outcomes: ["venta"] }))).toBe(true);
  });
});

describe("variables", () => {
  it("el trigger le suma las variables call.* al flujo", async () => {
    const db = fakeDb(
      {
        "calls:select": { data: { title: "Llamada con Ana", recorded_at: "2026-10-09T15:00:00Z", outcome: "venta", closer_score: 90, lead_score: 80, workspace_id: "ws1", recorded_by_user_id: "u1", next_step: "Enviar contrato" } },
        "workspaces:select": { data: { timezone: "UTC" } },
      },
      { workspace_member_profiles: { data: [{ user_id: "u1", full_name: "Wendy", meta_name: null }] } },
    );
    const a = { ...args("call_analyzed", payload()), supabase: db.client } as TriggerEventArgs;
    const vars = (await getTrigger("call_analyzed")!.variablesFor!(a)) as { call: Record<string, string> };
    expect(vars.call).toMatchObject({ title: "Llamada con Ana", outcome: "Venta", next_step: "Enviar contrato", closer_name: "Wendy", closer_score: "90", lead_score: "80" });
  });
});
