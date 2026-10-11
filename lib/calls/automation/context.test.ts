import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { buildCallVariables, callContextVariables, CALL_VARIABLE_KEYS, emptyCallVariables } from "./context";

describe("buildCallVariables", () => {
  const call = { title: "Llamada con Ana", recorded_at: "2026-10-09T15:00:00Z", outcome: "seguimiento_con_fecha", closer_score: 72, lead_score: 61, nextStep: "Llamar el martes" };

  it("arma las siete variables como texto", () => {
    expect(buildCallVariables(call, "Wendy", "America/Costa_Rica")).toEqual({
      title: "Llamada con Ana",
      date: "9 de octubre de 2026",
      outcome: "Seguimiento con fecha",
      next_step: "Llamar el martes",
      closer_name: "Wendy",
      closer_score: "72",
      lead_score: "61",
    });
  });
  it("lo que falta queda vacio, nunca 'null' ni '{{...}}'", () => {
    const v = buildCallVariables({ ...call, outcome: null, closer_score: null, lead_score: null, nextStep: null }, null, "UTC");
    expect(v).toMatchObject({ outcome: "", next_step: "", closer_name: "", closer_score: "", lead_score: "" });
    expect(Object.values(v).join(" ")).not.toMatch(/null|undefined|\{\{/);
  });
  it("la fecha sale en la zona del negocio", () => {
    expect(buildCallVariables({ ...call, recorded_at: "2026-10-12T05:30:00Z" }, null, "America/Costa_Rica").date).toBe("11 de octubre de 2026");
  });
  it("las variables vacias cubren las mismas claves", () => {
    expect(Object.keys(emptyCallVariables())).toEqual(CALL_VARIABLE_KEYS);
  });
});

describe("callContextVariables", () => {
  it("lee la llamada, el closer y la zona del negocio", async () => {
    const db = fakeDb(
      {
        "calls:select": { data: { title: "Llamada con Ana", recorded_at: "2026-10-09T15:00:00Z", outcome: "venta", closer_score: 90, lead_score: 80, workspace_id: "ws1", recorded_by_user_id: "u1", next_step: "Enviar el contrato" } },
        "workspaces:select": { data: { timezone: "America/Costa_Rica" } },
      },
      { workspace_member_profiles: { data: [{ user_id: "u1", full_name: "Wendy Mardigian", meta_name: null, email: "w@x.com", role: "owner" }] } },
    );
    expect(await callContextVariables(db.client, "c1")).toEqual({
      call: { title: "Llamada con Ana", date: "9 de octubre de 2026", outcome: "Venta", next_step: "Enviar el contrato", closer_name: "Wendy Mardigian", closer_score: "90", lead_score: "80" },
    });
  });
  it("una llamada que ya no existe da un objeto vacio", async () => {
    expect(await callContextVariables(fakeDb({ "calls:select": { data: null } }).client, "x")).toEqual({});
  });
});
