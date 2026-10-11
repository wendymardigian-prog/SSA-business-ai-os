import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));

import { sendCallToKnowledge, summarizeCall } from "./calls-use";

const CALL = "11111111-1111-4111-8111-111111111111";
const transcript = [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }];

function setup(opts: { call?: Record<string, unknown> | null; can?: string[]; duplicate?: boolean } = {}) {
  const user = fakeDb({ "calls:select": { data: opts.call === null ? null : { id: CALL, call_type: "cierre", transcript, summary_status: "none", ...opts.call } } });
  const service = fakeDb({ "scheduled_jobs:insert": opts.duplicate ? { error: { message: "dup", code: "23505" } } : { data: { id: "j" } }, "calls:update": { data: [{ id: CALL }] } });
  const can = opts.can ?? ["knowledge.edit"];
  mocks.permission.mockResolvedValue({ workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client, can: (k: string) => can.includes(k) });
  mocks.service.mockResolvedValue(service.client);
  return { user, service };
}

beforeEach(() => vi.clearAllMocks());

describe("summarizeCall", () => {
  it("pide calls.edit y sin el no encola nada", async () => {
    const { service } = setup();
    mocks.permission.mockResolvedValue(null);
    expect((await summarizeCall({ callId: CALL })).ok).toBe(false);
    expect(mocks.permission).toHaveBeenCalledWith("calls.edit");
    expect(service.writes()).toHaveLength(0);
  });
  it("encola un resumen manual a nombre de la persona y deja el resumen pendiente", async () => {
    const { service } = setup();
    expect((await summarizeCall({ callId: CALL })).ok).toBe(true);
    const job = service.writesTo("scheduled_jobs")[0].values as { type: string; dedupe_key: string; payload: Record<string, unknown> };
    expect(job).toMatchObject({ type: "call_summary", dedupe_key: `call_summary:${CALL}` });
    expect(job.payload).toMatchObject({ callId: CALL, manual: true, requestedBy: "u1" });
    expect(service.writesTo("calls")[0].values).toEqual({ summary_status: "pending" });
  });
  it("una llamada de equipo, sin transcripcion o que no se ve no se encola", async () => {
    for (const call of [{ call_type: "equipo" }, { transcript: [] }, null]) {
      const { service } = setup({ call });
      expect((await summarizeCall({ callId: CALL })).ok).toBe(false);
      expect(service.writesTo("scheduled_jobs")).toHaveLength(0);
    }
  });
  it("si ya hay un resumen en la cola, lo dice y no pisa el estado", async () => {
    const { service } = setup({ duplicate: true });
    expect(await summarizeCall({ callId: CALL })).toEqual({ ok: false, error: "Ya hay un resumen en la cola para esta llamada" });
    expect(service.writesTo("calls")).toHaveLength(0);
  });
  it("rechaza un id mal formado", async () => {
    setup();
    expect((await summarizeCall({ callId: "x" })).ok).toBe(false);
  });
});

describe("sendCallToKnowledge", () => {
  it("necesita calls.edit Y knowledge.edit", async () => {
    const { service } = setup({ can: [] });
    expect(await sendCallToKnowledge({ callId: CALL })).toEqual({ ok: false, error: "No tenés permiso para editar la base de conocimiento" });
    expect(service.writes()).toHaveLength(0);
    mocks.permission.mockResolvedValue(null);
    expect((await sendCallToKnowledge({ callId: CALL })).ok).toBe(false);
  });
  it("encola el job a nombre de la persona", async () => {
    const { service } = setup();
    expect((await sendCallToKnowledge({ callId: CALL })).ok).toBe(true);
    expect(service.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_index_knowledge", dedupe_key: `call_index_knowledge:${CALL}` });
  });
  it("una reunión de equipo no se manda: ni por el botón", async () => {
    const { service } = setup({ call: { call_type: "equipo" } });
    const r = await sendCallToKnowledge({ callId: CALL });
    expect(r.ok).toBe(false);
    expect(service.writesTo("scheduled_jobs")).toHaveLength(0);
  });
  it("sin transcripción o que no se ve, tampoco", async () => {
    expect((await (async () => { setup({ call: { transcript: [] } }); return sendCallToKnowledge({ callId: CALL }); })()).ok).toBe(false);
    setup({ call: null });
    expect((await sendCallToKnowledge({ callId: CALL })).ok).toBe(false);
  });
});
