import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { emitCallEvent } from "./emit";

const callRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  workspace_id: "ws1",
  contact_id: "ct1",
  call_type: "cierre",
  outcome: "venta",
  closer_score: 80,
  lead_score: 70,
  lead_qualification: "calificado",
  recorded_by_user_id: "u1",
  booking_id: null,
  analysis_run_id: "run-1",
  ...over,
});

describe("emitCallEvent", () => {
  it("una llamada con contacto emite el evento con el payload del plano", async () => {
    const db = fakeDb({ "calls:select": { data: callRow() }, "automation_events:insert": { data: null } });
    expect(await emitCallEvent(db.client, "call_analyzed", "c1")).toBe(true);
    expect(db.writesTo("automation_events")[0].values).toEqual({
      workspace_id: "ws1",
      event_type: "call_analyzed",
      contact_id: "ct1",
      payload: { call_id: "c1", call_type: "cierre", outcome: "venta", closer_score: 80, lead_score: 70, lead_qualification: "calificado", closer_id: "u1", booking_id: null, analysis_run_id: "run-1" },
    });
  });

  it("una llamada SIN contacto no emite nada", async () => {
    const db = fakeDb({ "calls:select": { data: callRow({ contact_id: null }) } });
    expect(await emitCallEvent(db.client, "call_analyzed", "c1")).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("una llamada que ya no existe o esta archivada no emite", async () => {
    const db = fakeDb({ "calls:select": { data: null } });
    expect(await emitCallEvent(db.client, "call_linked", "x")).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("nunca lanza: si la cola falla, devuelve false", async () => {
    const failing = fakeDb({ "calls:select": { data: callRow() }, "automation_events:insert": { error: { message: "boom" } } });
    expect(await emitCallEvent(failing.client, "call_linked", "c1")).toBe(false);
    const broken = { from: () => { throw new Error("db caida"); } } as never;
    expect(await emitCallEvent(broken, "call_linked", "c1")).toBe(false);
  });
});
