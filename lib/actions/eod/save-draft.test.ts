/**
 * La acción de guardar el borrador: la persona sale de la sesión (nunca del navegador),
 * y la revisión y el conflicto llegan tal cual del núcleo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SESSION_USER = "55555555-5555-4555-8555-555555555555";
const WS = "11111111-1111-4111-8111-111111111111";
const core = vi.fn();

vi.mock("@/lib/auth/guards", () => ({
  getMemberAction: vi.fn(async () => ({ user: { id: SESSION_USER }, workspace: { id: WS } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/eod/server-ports", () => ({ eodPorts: vi.fn(() => ({})) }));
vi.mock("@/lib/eod/submit", () => ({ saveDraftCore: (...args: unknown[]) => core(...args) }));

describe("saveEodDraft", () => {
  beforeEach(() => core.mockReset());

  it("usa la persona y el workspace de la sesión, aunque el navegador mande otros", async () => {
    core.mockResolvedValue({ ok: true, rev: 4, savedAt: "x" });
    const { saveEodDraft } = await import("./save-draft");
    await saveEodDraft({ formId: "f", reportDate: "2026-10-12", rev: 3, data: {}, userId: "otro", workspaceId: "otro" } as never);
    expect(core.mock.calls[0][1]).toMatchObject({ userId: SESSION_USER, workspaceId: WS, rev: 3 });
  });

  it("un conflicto vuelve con el borrador vigente para fusionar", async () => {
    const current = { data: { answers: {}, channels: {} }, rev: 7, savedAt: "y" };
    core.mockResolvedValue({ ok: false, code: "conflict", error: "Se actualizó con lo que cargaste en otra pestaña", current });
    const { saveEodDraft } = await import("./save-draft");
    const result = await saveEodDraft({ formId: "f", reportDate: "2026-10-12", rev: 3, data: {} });
    expect(result).toMatchObject({ ok: false, code: "conflict", current: { rev: 7 } });
  });

  it("sin sesión no llega al núcleo", async () => {
    const guards = await import("@/lib/auth/guards");
    vi.mocked(guards.getMemberAction).mockResolvedValueOnce(null);
    const { saveEodDraft } = await import("./save-draft");
    expect(await saveEodDraft({ formId: "f", reportDate: "2026-10-12", rev: 0, data: {} })).toMatchObject({ ok: false });
    expect(core).not.toHaveBeenCalled();
  });
});
