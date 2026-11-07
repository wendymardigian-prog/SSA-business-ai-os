import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { loadCallConfig } from "./config-data";

describe("loadCallConfig", () => {
  const user = () => fakeDb({ "calls:select": { data: [{ id: "c1", title: "Llamada", recorded_at: "2026-10-02T00:00:00Z", closer_score: 70, category_id: "t1", area_id: "a1" }] } });
  const service = () => fakeDb({ "calls:select": { data: [] } });

  it("clasificacion: la configuracion, las areas y los tipos de la agenda, y las claves viejas de las reglas", async () => {
    const VENTAS = "11111111-1111-4111-8111-111111111111";
    const CIERRE = "22222222-2222-4222-8222-222222222222";
    const db = fakeDb({
      "booking_categories:select": {
        data: [
          { id: VENTAS, parent_id: null, name: "Ventas", color: null, position: 0, is_system: true, archived_at: null, system_key: "ventas" },
          { id: CIERRE, parent_id: VENTAS, name: "Cierre", color: null, position: 0, is_system: true, archived_at: null, system_key: "ventas.cierre" },
        ],
      },
    });
    const r = await loadCallConfig({ service: db.client, userClient: user().client, workspaceId: "ws1", task: "call_classification", canEdit: false, stored: {} });
    expect(r).toMatchObject({
      task: "call_classification",
      canEdit: false,
      categoryGroups: [{ areaId: VENTAS, areaName: "Ventas", types: [{ id: CIERRE, name: "Cierre" }] }],
      legacyRuleTargets: { cierre: CIERRE },
    });
  });

  it("analisis: ofrece las grabaciones con transcripcion que la persona ve, ya analizadas o no", async () => {
    const u = user();
    const r = await loadCallConfig({ service: service().client, userClient: u.client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: {} });
    expect(r.task === "call_analysis" && r.testableCalls).toEqual([{ id: "c1", title: "Llamada", recordedAt: "2026-10-02T00:00:00Z", closerScore: 70, categoryId: "t1", areaId: "a1" }]);
    const filters = u.calls[0].filters.map((f) => f.column);
    expect(filters).not.toContain("analysis_status");
  });

  it("analisis: junta los analizadores y las versiones de instrucciones de cada uno", async () => {
    const svc = fakeDb({
      "call_analysis_profiles:select": { data: [{ id: "p1", workspace_id: "ws1", category_id: "t1", shape: "general", mode: "manual", rules: {}, rubric: null, auto_summary: true, auto_memory: true, auto_knowledge: false, active_prompt_version: 2 }] },
      "ai_task_prompt_versions:select": { data: [{ variant: "p1", version: 2, instructions: "dos", note: null, created_at: "2026-10-02T00:00:00Z" }, { variant: "p1", version: 1, instructions: "uno", note: null, created_at: "2026-10-01T00:00:00Z" }] },
    });
    const r = await loadCallConfig({ service: svc.client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: {} });
    expect(r.task === "call_analysis" && r.profiles.map((p) => p.id)).toEqual(["p1"]);
    expect(r.task === "call_analysis" && r.profileVersions.p1.map((v) => v.version)).toEqual([2, 1]);
    expect(r.task === "call_analysis" && r.defaultInstructions.general).toBeTruthy();
  });

  it("analisis: marca lo de Ventas por su clave, no por el nombre", async () => {
    const svc = fakeDb({
      "booking_categories:select": {
        data: [
          { id: "v", parent_id: null, name: "Comercial", color: null, position: 0, is_system: true, archived_at: null, system_key: "ventas" },
          { id: "c", parent_id: "v", name: "Reunión final", color: null, position: 0, is_system: true, archived_at: null, system_key: "ventas.cierre" },
          { id: "s", parent_id: null, name: "Ventas de servicio", color: null, position: 1, is_system: true, archived_at: null, system_key: "servicio" },
        ],
      },
    });
    const r = await loadCallConfig({ service: svc.client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: {} });
    expect(r.task === "call_analysis" && r.salesCategoryIds).toEqual(["v", "c"]);
  });

  it("solo lectura: no consulta las propuestas de la IA", async () => {
    const svc = service();
    await loadCallConfig({ service: svc.client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: false, stored: {} });
    expect(svc.calls.filter((c) => c.table === "calls")).toHaveLength(0);
  });
});
