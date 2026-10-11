import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { loadCallConfig, parseRubricHistory } from "./config-data";
import { DEFAULT_ANALYSIS, DEFAULT_CLASSIFICATION } from "./task-settings";

const saved = (version: number) => ({ ...DEFAULT_ANALYSIS, rubric: { ...DEFAULT_ANALYSIS.rubric, version } });

describe("parseRubricHistory", () => {
  it("saca la rubrica y su version de cada guardado, de la mas nueva a la mas vieja", () => {
    const rows = [
      { id: "a", created_at: "2026-10-03T00:00:00Z", changes: { "ai_background_settings.call_analysis": { old: null, new: saved(3) } } },
      { id: "b", created_at: "2026-10-01T00:00:00Z", changes: { "ai_background_settings.call_analysis": { old: null, new: saved(2) } } },
    ];
    expect(parseRubricHistory(rows).map((r) => [r.id, r.version])).toEqual([["a", 3], ["b", 2]]);
  });
  it("descarta entradas sin rubrica legible", () => {
    expect(parseRubricHistory([{ id: "x", created_at: "2026-10-01T00:00:00Z", changes: { otro: 1 } }, { id: "y", created_at: "2026-10-01T00:00:00Z", changes: null }])).toEqual([]);
  });
});

describe("loadCallConfig", () => {
  const user = () => fakeDb({ "calls:select": { data: [{ id: "c1", title: "Llamada", recorded_at: "2026-10-02T00:00:00Z", closer_score: 70 }] } });
  const service = () => fakeDb({ "calls:select": { data: [] }, "audit_log:select": { data: [] } });

  it("clasificacion: la configuracion y las propuestas de tipo, solo para quien puede editar", async () => {
    const withProposals = fakeDb({ "calls:select": { data: [{ call_type_proposed: "Webinar" }] } });
    const editor = await loadCallConfig({ service: withProposals.client, userClient: user().client, workspaceId: "ws1", task: "call_classification", canEdit: true, stored: {} });
    expect(editor).toMatchObject({ task: "call_classification", canEdit: true, typeProposals: [{ key: "webinar", calls: 1 }] });
    const reader = await loadCallConfig({ service: withProposals.client, userClient: user().client, workspaceId: "ws1", task: "call_classification", canEdit: false, stored: {} });
    expect(reader).toMatchObject({ canEdit: false, typeProposals: [] });
  });

  it("analisis: dice que usa la rubrica generica mientras no haya una guardada", async () => {
    const r = await loadCallConfig({ service: service().client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: {} });
    expect(r.task === "call_analysis" && r.usingDefaultRubric).toBe(true);
    const guardada = await loadCallConfig({ service: service().client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: { call_analysis: saved(2) } });
    expect(guardada.task === "call_analysis" && guardada.usingDefaultRubric).toBe(false);
    expect(guardada.task === "call_analysis" && guardada.settings.rubric.version).toBe(2);
  });

  it("analisis: ofrece las ultimas llamadas analizadas que la persona ve, y los tipos validos", async () => {
    const stored = { call_classification: { ...DEFAULT_CLASSIFICATION, custom_types: [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: false }] } };
    const r = await loadCallConfig({ service: service().client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored });
    expect(r.task === "call_analysis" && r.testableCalls).toEqual([{ id: "c1", title: "Llamada", recordedAt: "2026-10-02T00:00:00Z", closerScore: 70 }]);
    expect(r.task === "call_analysis" && r.validTypes).toContain("demo");
  });

  it("solo lectura: no consulta propuestas ni historial", async () => {
    const svc = service();
    await loadCallConfig({ service: svc.client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: false, stored: {} });
    expect(svc.calls).toHaveLength(0);
  });

  it("el historial de la rubrica sale del audit_log del workspace", async () => {
    const svc = fakeDb({ "calls:select": { data: [] }, "audit_log:select": { data: [{ id: "a", created_at: "2026-10-03T00:00:00Z", changes: { "ai_background_settings.call_analysis": { old: null, new: saved(2) } } }] } });
    const r = await loadCallConfig({ service: svc.client, userClient: user().client, workspaceId: "ws1", task: "call_analysis", canEdit: true, stored: {} });
    expect(r.task === "call_analysis" && r.rubricHistory[0]).toMatchObject({ id: "a", version: 2 });
    const q = svc.calls.find((c) => c.table === "audit_log")!;
    expect(q.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "entity_type", value: "workspace" }), expect.objectContaining({ column: "workspace_id", value: "ws1" })]));
  });
});
