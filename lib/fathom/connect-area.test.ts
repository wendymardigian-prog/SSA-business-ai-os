import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { applyConnectArea } from "./connect-area";

const AREA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const back = (id: string) => `/dashboard/llamadas/mi-fathom?area=${id}`;
const cat = (id: string) => ({ id, parent_id: null, name: "Servicio", color: null, position: 0, is_system: true, archived_at: null, system_key: "servicio" });

const setup = (settings: unknown = {}) =>
  fakeDb({ "booking_categories:select": { data: [cat(AREA)] }, "oauth_connections:select": { data: { fathom_settings: settings } }, "oauth_connections:update": { data: null } });

describe("applyConnectArea", () => {
  it("deja el area del link como la de la conexion, filtrando por el negocio", async () => {
    const db = setup();
    await applyConnectArea(db.client, "ws1", "c1", back(AREA));
    const w = db.writesTo("oauth_connections")[0];
    expect((w.values as { fathom_settings: { default_area_id: string } }).fathom_settings.default_area_id).toBe(AREA);
    expect(w.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "workspace_id", value: "ws1" })]));
  });
  it("un area de otro negocio no se escribe", async () => {
    const db = setup();
    await applyConnectArea(db.client, "ws1", "c1", back(OTRA));
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
  });
  it("nunca pisa un area ya elegida", async () => {
    const db = setup({ default_area_id: OTRA });
    await applyConnectArea(db.client, "ws1", "c1", back(AREA));
    expect(db.writesTo("oauth_connections")).toHaveLength(0);
  });
  it("sin area en el link no consulta nada", async () => {
    const db = setup();
    await applyConnectArea(db.client, "ws1", "c1", "/dashboard/llamadas/mi-fathom");
    expect(db.calls).toHaveLength(0);
  });
  it("un error no tumba la conexion", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ "booking_categories:select": () => { throw new Error("boom"); } });
    await expect(applyConnectArea(db.client, "ws1", "c1", back(AREA))).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
