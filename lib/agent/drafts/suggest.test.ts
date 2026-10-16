import { describe, it, expect, vi, beforeEach } from "vitest";

const { listConnectedAiProviders } = vi.hoisted(() => ({
  listConnectedAiProviders: vi.fn(async () => [{ provider: "anthropic", label: "Anthropic", defaultModel: "m", models: ["m"] }]),
}));
vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders }));

import { requestSuggestion } from "./suggest";
import { turnWorld } from "../testing/turn-world";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  listConnectedAiProviders.mockClear();
});

const conv = { id: "cv-1", workspace_id: "ws-1", channel_id: "ch-1", contact_id: "c-1" };
const jobs = (w: ReturnType<typeof turnWorld>) => w.db.rows("scheduled_jobs");

describe("requestSuggestion (Sugerir respuesta)", () => {
  it("agenda un turno con el flag suggest cuando hay agente, IA y un mensaje del contacto", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result.ok).toBe(true);
    expect(jobs(w)).toHaveLength(1);
    expect(jobs(w)[0]).toMatchObject({ type: "agent_burst", dedupe_key: "agent_burst:cv-1" });
    expect((jobs(w)[0].payload as Record<string, unknown>).suggest).toBe(true);
  });

  it("sin una IA conectada no agenda nada y lo explica", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    listConnectedAiProviders.mockResolvedValueOnce([]);
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/IA conectada/);
    expect(jobs(w)).toHaveLength(0);
  });

  it("con el agente apagado para el canal no agenda", async () => {
    const w = turnWorld({ draft: true, agent: { is_enabled: false } });
    w.addInbound("hola", 0);
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result.ok).toBe(false);
    expect(jobs(w)).toHaveLength(0);
  });

  it("con la conversacion en agente apagado igual deja pedirla (la pidio una persona)", async () => {
    const w = turnWorld({ draft: true, conversation: { agent_enabled: false } });
    w.addInbound("hola", 0);
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result.ok).toBe(true);
  });

  it("si ya hay un borrador vivo no pide otro", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    w.db.rows("agent_drafts").push({ id: "d-1", conversation_id: "cv-1", status: "pending" });
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result).toMatchObject({ ok: false, code: "turn_pending" });
    expect(jobs(w)).toHaveLength(0);
  });

  it("sin mensajes del contacto no hay nada que responder", async () => {
    const w = turnWorld({ draft: true });
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result.ok).toBe(false);
    expect(jobs(w)).toHaveLength(0);
  });

  it("con un turno ya agendado no agenda otro", async () => {
    const w = turnWorld({ draft: true });
    w.addInbound("hola", 0);
    jobs(w).push({ id: "j-1", type: "agent_burst", dedupe_key: "agent_burst:cv-1", status: "pending", payload: {} });
    const result = await requestSuggestion({ service: w.db.client, conversation: conv });
    expect(result).toMatchObject({ ok: false, code: "turn_pending" });
    expect(jobs(w)).toHaveLength(1);
  });
});
