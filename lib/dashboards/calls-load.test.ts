import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { loadCallRows, MAX_PAGES } from "./calls-load";

const row = (i: number) => ({
  id: `c${i}`,
  recorded_at: "2026-10-07T15:00:00Z",
  recorded_by_user_id: "ana",
  call_type: "cierre",
  closer_score: 70,
  lead_score: 60,
  lead_qualification: "con_reservas",
  outcome: "venta",
  main_objection: "precio",
  has_open_alerts: false,
  rubrica: [{ codigo: "rapport", nombre: "Rapport", puntaje: 4 }],
});

describe("loadCallRows", () => {
  it("lee solo analizadas y activas del workspace y arma las filas con sus criterios", async () => {
    const db = fakeDb({ "calls:select": { data: [row(1)] } });
    const r = await loadCallRows(db.client, { workspaceId: "ws1", range: { from: "2026-10-01T00:00:00Z", to: null } });
    expect(r).toMatchObject({ truncated: false, failed: false });
    expect(r.calls[0]).toMatchObject({ id: "c1", closerId: "ana", closerScore: 70, mainObjection: "precio", criteria: [{ code: "rapport", name: "Rapport", score: 4 }] });
    expect(db.calls[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "eq", column: "workspace_id", value: "ws1" }),
      expect.objectContaining({ method: "eq", column: "analysis_status", value: "analyzed" }),
      expect.objectContaining({ method: "is", column: "archived_at" }),
      expect.objectContaining({ method: "gte", column: "recorded_at", value: "2026-10-01T00:00:00Z" }),
    ]));
  });

  it("puede acotar a un closer; sin acotar no filtra", async () => {
    const withCloser = fakeDb({ "calls:select": { data: [] } });
    await loadCallRows(withCloser.client, { workspaceId: "ws1", range: { from: null, to: null }, closerId: "ana" });
    expect(withCloser.calls[0].filters).toContainEqual(expect.objectContaining({ column: "recorded_by_user_id", value: "ana" }));
    const without = fakeDb({ "calls:select": { data: [] } });
    await loadCallRows(without.client, { workspaceId: "ws1", range: { from: null, to: null } });
    expect(without.calls[0].filters.some((f) => f.column === "recorded_by_user_id")).toBe(false);
  });

  it("NO pide la transcripcion ni el analisis entero, y solo lee (con el cliente que recibe: la RLS decide)", async () => {
    const db = fakeDb({ "calls:select": { data: [] } });
    await loadCallRows(db.client, { workspaceId: "ws1", range: { from: null, to: null } });
    expect(db.writes()).toHaveLength(0);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/dashboards/calls-load.ts", "utf8");
    expect(src).not.toMatch(/transcript/);
    expect(src).not.toMatch(/createServiceClient/);
    expect(src).not.toMatch(/select\("\*"/);
  });

  it("una falla de lectura se avisa y no devuelve nada a medias", async () => {
    const db = fakeDb({ "calls:select": { error: { message: "boom" } } });
    expect(await loadCallRows(db.client, { workspaceId: "ws1", range: { from: null, to: null } })).toEqual({ calls: [], truncated: false, failed: true });
  });

  it("pasado el techo de paginas, devuelve lo mas reciente y avisa", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(i));
    const db = fakeDb({ "calls:select": { data: full } });
    const r = await loadCallRows(db.client, { workspaceId: "ws1", range: { from: null, to: null } });
    expect(r.truncated).toBe(true);
    expect(r.calls).toHaveLength(1000 * MAX_PAGES);
  });
});
