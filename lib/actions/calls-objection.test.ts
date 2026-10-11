import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), notify: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/calls/notify", () => ({ notifyObjection: mocks.notify }));

import { objectToAnalysis, resolveObjection } from "./calls-objection";

const CALL = "11111111-1111-4111-8111-111111111111";
const OBJ = "22222222-2222-4222-8222-222222222222";

function setup(call: Record<string, unknown> | null, userId = "closer-1") {
  const user = fakeDb({ "calls:select": { data: call } });
  const service = fakeDb({ "calls:update": { data: [{ id: CALL }] } });
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: userId }, supabase: user.client });
  mocks.service.mockResolvedValue(service.client);
  return { user, service };
}
const baseCall = (over: Record<string, unknown> = {}) => ({ id: CALL, title: "Llamada con Ana", recorded_by_user_id: "closer-1", objections: [], analysis_status: "analyzed", ...over });

beforeEach(() => vi.clearAllMocks());

describe("objectToAnalysis", () => {
  it("el closer de la llamada objeta: se guarda, se audita y se avisa a los editores (no a el)", async () => {
    const { service } = setup(baseCall());
    const r = await objectToAnalysis({ callId: CALL, section: "rubrica", note: "Sí pregunté por el decisor, minuto 12" });
    expect(r.ok).toBe(true);
    const saved = (service.writesTo("calls")[0].values as { objections: Array<Record<string, unknown>> }).objections;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ section: "rubrica", by: "closer-1", note: "Sí pregunté por el decisor, minuto 12", resolved_at: null, resolved_by: null });
    expect(saved[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.objection", performedBy: "closer-1" }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.anything(), { workspaceId: "ws1", callId: CALL, closerId: "closer-1", callTitle: "Llamada con Ana" });
  });

  it("alguien que NO es el closer de la llamada no puede objetar", async () => {
    const { service } = setup(baseCall(), "otra-persona");
    const r = await objectToAnalysis({ callId: CALL, section: "rubrica", note: "No estoy de acuerdo" });
    expect(r.ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("agrega a las objeciones que ya habia, sin pisarlas", async () => {
    const previous = { id: OBJ, section: "resumen", by: "closer-1", at: "2026-10-01T00:00:00Z", note: "antes", resolved_at: null, resolved_by: null };
    const { service } = setup(baseCall({ objections: [previous] }));
    await objectToAnalysis({ callId: CALL, section: "dolor", note: "otra mas" });
    expect((service.writesTo("calls")[0].values as { objections: unknown[] }).objections).toHaveLength(2);
  });

  it("valida el comentario, la seccion y el estado", async () => {
    const { service } = setup(baseCall());
    expect((await objectToAnalysis({ callId: CALL, section: "rubrica", note: "ab" })).ok).toBe(false);
    expect((await objectToAnalysis({ callId: CALL, section: "rubrica", note: "x".repeat(1001) })).ok).toBe(false);
    expect((await objectToAnalysis({ callId: CALL, section: "alertas", note: "no estoy de acuerdo" })).ok).toBe(false);
    expect((await objectToAnalysis({ callId: "no", section: "rubrica", note: "no estoy de acuerdo" })).ok).toBe(false);
    setup(baseCall({ analysis_status: "pending" }));
    expect((await objectToAnalysis({ callId: CALL, section: "rubrica", note: "no estoy de acuerdo" })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("una llamada que la persona no ve no existe", async () => {
    setup(null);
    expect(await objectToAnalysis({ callId: CALL, section: "rubrica", note: "no estoy de acuerdo" })).toEqual({ ok: false, error: "No encontré esa llamada" });
  });

  it("no cambia ningun puntaje: solo escribe la columna objections", async () => {
    const { service } = setup(baseCall());
    await objectToAnalysis({ callId: CALL, section: "rubrica", note: "no estoy de acuerdo" });
    expect(Object.keys(service.writesTo("calls")[0].values as object)).toEqual(["objections"]);
  });
});

describe("resolveObjection", () => {
  const open = { id: OBJ, section: "rubrica", by: "closer-1", at: "2026-10-01T00:00:00Z", note: "n", resolved_at: null, resolved_by: null };

  it("pide calls.edit y deja quien y cuando", async () => {
    const { service } = setup(baseCall({ objections: [open] }), "editor-1");
    const r = await resolveObjection({ callId: CALL, objectionId: OBJ });
    expect(r.ok).toBe(true);
    expect(mocks.permission).toHaveBeenCalledWith("calls.edit");
    const saved = (service.writesTo("calls")[0].values as { objections: Array<Record<string, unknown>> }).objections[0];
    expect(saved).toMatchObject({ resolved_by: "editor-1" });
    expect(typeof saved.resolved_at).toBe("string");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.objection_resolved", performedBy: "editor-1" }));
  });

  it("sin permiso o con una objecion que no existe no escribe", async () => {
    const { service } = setup(baseCall({ objections: [open] }));
    expect((await resolveObjection({ callId: CALL, objectionId: "33333333-3333-4333-8333-333333333333" })).ok).toBe(false);
    mocks.permission.mockResolvedValue(null);
    expect((await resolveObjection({ callId: CALL, objectionId: OBJ })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("resolver dos veces no reescribe", async () => {
    const { service } = setup(baseCall({ objections: [{ ...open, resolved_at: "2026-10-02T00:00:00Z", resolved_by: "x" }] }));
    expect((await resolveObjection({ callId: CALL, objectionId: OBJ })).ok).toBe(true);
    expect(service.writes()).toHaveLength(0);
  });
});
