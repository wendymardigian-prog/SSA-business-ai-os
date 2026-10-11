import { describe, expect, it } from "vitest";
import { callDedupeKey, callEventMatches, callEventPayload, isCallTriggerType, type CallEventPayload } from "./triggers";

const payload = (over: Partial<CallEventPayload> = {}): CallEventPayload => ({
  call_id: "c1",
  call_type: "cierre",
  outcome: "seguimiento_con_fecha",
  closer_score: 70,
  lead_score: 62,
  lead_qualification: "con_reservas",
  closer_id: "u1",
  booking_id: null,
  ...over,
});

describe("callEventMatches: call_analyzed", () => {
  it("sin filtros vale cualquier llamada", () => {
    expect(callEventMatches("call_analyzed", {}, payload())).toBe(true);
  });
  it("filtrado a outcomes: ['venta'] NO inicia con un resultado seguimiento_con_fecha", () => {
    expect(callEventMatches("call_analyzed", { outcomes: ["venta"] }, payload())).toBe(false);
    expect(callEventMatches("call_analyzed", { outcomes: ["venta"] }, payload({ outcome: "venta" }))).toBe(true);
  });
  it("lead_score_min: 60 con una llamada de 62 SI inicia; con 55 no", () => {
    expect(callEventMatches("call_analyzed", { lead_score_min: 60 }, payload({ lead_score: 62 }))).toBe(true);
    expect(callEventMatches("call_analyzed", { lead_score_min: 60 }, payload({ lead_score: 55 }))).toBe(false);
  });
  it("los limites son inclusivos y se pueden combinar", () => {
    expect(callEventMatches("call_analyzed", { closer_score_min: 70, closer_score_max: 70 }, payload({ closer_score: 70 }))).toBe(true);
    expect(callEventMatches("call_analyzed", { closer_score_min: 50, closer_score_max: 69 }, payload({ closer_score: 70 }))).toBe(false);
  });
  it("con un limite de puntaje, una llamada SIN puntaje no entra (no se adivina)", () => {
    expect(callEventMatches("call_analyzed", { lead_score_min: 10 }, payload({ lead_score: null }))).toBe(false);
    expect(callEventMatches("call_analyzed", { lead_score_max: 90 }, payload({ lead_score: null }))).toBe(false);
    expect(callEventMatches("call_analyzed", {}, payload({ lead_score: null }))).toBe(true);
  });
  it("filtra por tipo, closer y calificacion", () => {
    expect(callEventMatches("call_analyzed", { call_types: ["seguimiento"] }, payload())).toBe(false);
    expect(callEventMatches("call_analyzed", { call_types: ["cierre", "seguimiento"] }, payload())).toBe(true);
    expect(callEventMatches("call_analyzed", { closer_ids: ["u2"] }, payload())).toBe(false);
    expect(callEventMatches("call_analyzed", { qualifications: ["calificado"] }, payload())).toBe(false);
    expect(callEventMatches("call_analyzed", { qualifications: ["con_reservas"] }, payload())).toBe(true);
  });
  it("una lista vacia significa cualquiera, nunca ninguno", () => {
    expect(callEventMatches("call_analyzed", { call_types: [], outcomes: [], closer_ids: [], qualifications: [] }, payload())).toBe(true);
    expect(callEventMatches("call_analyzed", { call_types: null }, payload())).toBe(true);
  });
  it("si el payload no trae el dato y hay filtro, no entra", () => {
    expect(callEventMatches("call_analyzed", { outcomes: ["venta"] }, payload({ outcome: null }))).toBe(false);
    expect(callEventMatches("call_analyzed", { closer_ids: ["u1"] }, payload({ closer_id: null }))).toBe(false);
  });
});

describe("callEventMatches: call_linked", () => {
  it("solo mira tipo y closer: los filtros de resultado y puntaje no aplican a un vinculo", () => {
    expect(callEventMatches("call_linked", { outcomes: ["venta"], lead_score_min: 99 }, payload())).toBe(true);
    expect(callEventMatches("call_linked", { call_types: ["triaje"] }, payload())).toBe(false);
    expect(callEventMatches("call_linked", { closer_ids: ["u2"] }, payload())).toBe(false);
  });
});

describe("callDedupeKey", () => {
  it("lleva la llamada, el tipo y la corrida o el contacto", () => {
    expect(callDedupeKey("call_analyzed", "c1", "run-1")).toBe("call:c1:call_analyzed:run-1");
    expect(callDedupeKey("call_linked", "c1", "ct-9")).toBe("call:c1:call_linked:ct-9");
  });
  it("un analisis regenerado (otra corrida) tiene otra clave; el mismo evento, la misma", () => {
    expect(callDedupeKey("call_analyzed", "c1", "run-1")).not.toBe(callDedupeKey("call_analyzed", "c1", "run-2"));
    expect(callDedupeKey("call_analyzed", "c1", "run-1")).toBe(callDedupeKey("call_analyzed", "c1", "run-1"));
  });
});

describe("callEventPayload", () => {
  const call = { id: "c1", contact_id: "ct1", call_type: "cierre", outcome: "venta", closer_score: 80, lead_score: 70, lead_qualification: "calificado", recorded_by_user_id: "u1", booking_id: "b1", analysis_run_id: "run-1" };
  it("arma el payload del plano", () => {
    expect(callEventPayload(call)).toEqual({ call_id: "c1", call_type: "cierre", outcome: "venta", closer_score: 80, lead_score: 70, lead_qualification: "calificado", closer_id: "u1", booking_id: "b1", analysis_run_id: "run-1" });
  });
  it("sin corrida no agrega la clave", () => {
    expect(callEventPayload({ ...call, analysis_run_id: null })).not.toHaveProperty("analysis_run_id");
  });
});

describe("isCallTriggerType", () => {
  it("reconoce los dos", () => {
    expect(isCallTriggerType("call_analyzed")).toBe(true);
    expect(isCallTriggerType("call_linked")).toBe(true);
    expect(isCallTriggerType("booking_created")).toBe(false);
  });
});
