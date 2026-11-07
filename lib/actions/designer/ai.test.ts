import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPermissionAction, createServiceClient, requests } = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  createServiceClient: vi.fn(async () => ({ servicio: true })),
  requests: {
    submitRequest: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { threadId: "th", messageId: "m" } })),
    submitStyleChange: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { messageId: "m" } })),
    submitTextProposal: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { messageId: "m" } })),
    loadConversationView: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: { threadId: null, messages: [], ai: { connected: true, message: null } } })),
    answerProposalRequest: vi.fn(async (..._args: unknown[]) => ({ ok: true as const, data: {} })),
  },
}));

vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: (key: string) => getPermissionAction(key) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));
vi.mock("@/lib/designer/ai/requests", () => requests);

import { answerProposal, changeStyle, loadConversation, proposeTemplateTexts, sendAiMessage, startAiDesign } from "./ai";

const session = { workspace: { id: "ws-de-la-sesion" }, user: { id: "user-de-la-sesion" }, can: (key: string) => key === "designer.manage" };

beforeEach(() => {
  vi.clearAllMocks();
  getPermissionAction.mockResolvedValue(session);
});

describe("acciones de la IA del Diseñador: el permiso y el negocio salen de la sesión", () => {
  it("sin permiso responden «No tenés permiso» y no tocan nada", async () => {
    getPermissionAction.mockResolvedValue(null);
    const expected = { ok: false, error: "No tenés permiso para hacer esto." };
    expect(await startAiDesign({ kind: "design", id: "d1", prompt: "x", style: null, attachments: [] })).toEqual(expected);
    expect(await sendAiMessage({ kind: "design", id: "d1", text: "x", page: null, baseRev: 0 })).toEqual(expected);
    expect(await loadConversation({ kind: "design", id: "d1" })).toEqual(expected);
    expect(await proposeTemplateTexts({ templateId: "t1" })).toEqual(expected);
    expect(await answerProposal({ kind: "template", id: "t1", messageId: "m", accept: true })).toEqual(expected);
    expect(await changeStyle({ kind: "design", id: "d1", style: "minimal" })).toEqual(expected);
    for (const fn of Object.values(requests)) expect(fn).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("pedir y cambiar piden designer.edit; leer la conversación, designer.view", async () => {
    await startAiDesign({ kind: "design", id: "d1", prompt: "x", style: null, attachments: [] });
    await sendAiMessage({ kind: "design", id: "d1", text: "x", page: 2, baseRev: 1 });
    await proposeTemplateTexts({ templateId: "t1" });
    await answerProposal({ kind: "template", id: "t1", messageId: "m", accept: false });
    await changeStyle({ kind: "design", id: "d1", style: "minimal" });
    expect(getPermissionAction.mock.calls.map((c) => c[0])).toEqual(["designer.edit", "designer.edit", "designer.edit", "designer.edit", "designer.edit"]);
    getPermissionAction.mockClear();
    await loadConversation({ kind: "design", id: "d1" });
    expect(getPermissionAction.mock.calls.map((c) => c[0])).toEqual(["designer.view"]);
  });

  it("la conversación dice si puede crear estilos propios (designer.manage)", async () => {
    const withManage = await loadConversation({ kind: "design", id: "d1" });
    expect(withManage.ok && withManage.data.canManage).toBe(true);
    getPermissionAction.mockResolvedValue({ ...session, can: () => false });
    const without = await loadConversation({ kind: "design", id: "d1" });
    expect(without.ok && without.data.canManage).toBe(false);
  });

  it("el negocio y la persona son los de la sesión, aunque el navegador mande otros", async () => {
    const hostile = { kind: "design", id: "d1", prompt: "x", style: null, attachments: [], workspaceId: "otro-negocio", userId: "otra-persona" } as never;
    await startAiDesign(hostile);
    expect(requests.submitRequest).toHaveBeenCalledWith({ servicio: true }, expect.objectContaining({ workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion", mode: "first" }));
    expect(JSON.stringify(requests.submitRequest.mock.calls[0])).not.toContain("otro-negocio");
    await answerProposal({ kind: "template", id: "t1", messageId: "m", accept: true, workspaceId: "otro-negocio" } as never);
    expect(requests.answerProposalRequest).toHaveBeenCalledWith({ servicio: true }, expect.objectContaining({ workspaceId: "ws-de-la-sesion", userId: "user-de-la-sesion" }));
  });

  it("sendAiMessage pasa el alcance y la rev; changeStyle y proposeTemplateTexts, lo suyo", async () => {
    await sendAiMessage({ kind: "design", id: "d1", text: "Acortá", page: 2, baseRev: 7 });
    expect(requests.submitRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "change", text: "Acortá", page: 2, baseRev: 7 }));
    await changeStyle({ kind: "template", id: "t1", style: "impact" });
    expect(requests.submitStyleChange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "template", id: "t1", style: "impact" }));
    await proposeTemplateTexts({ templateId: "t9" });
    expect(requests.submitTextProposal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ templateId: "t9" }));
  });

  it("un imprevisto no lanza hacia la pantalla", async () => {
    requests.submitRequest.mockRejectedValueOnce(new Error("la base se cayó"));
    const out = await sendAiMessage({ kind: "design", id: "d1", text: "x", page: null, baseRev: 0 });
    expect(out).toEqual({ ok: false, error: "No pude hacerlo ahora. Probá de nuevo." });
  });
});
