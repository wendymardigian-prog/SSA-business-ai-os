import { describe, expect, it, vi } from "vitest";
import { ensureDefaultAgents } from "@/lib/agent/defaults";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { DEFAULT_COPYWRITER_INSTRUCTIONS } from "@/lib/content/copywriter";

vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders: vi.fn(async () => []) }));

function serviceWith(rpc: (...args: unknown[]) => unknown) {
  return { rpc: vi.fn(rpc) } as unknown as Parameters<typeof ensureDefaultAgents>[0];
}

describe("ensureDefaultAgents (00252)", () => {
  it("sin IA conectada no llama a la base: el modelo de cada agente sale de la primera IA", async () => {
    const service = serviceWith(async () => ({ data: null, error: null }));
    expect(await ensureDefaultAgents(service, "ws-1", [])).toBeNull();
    expect((service as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it("pasa la primera IA, su modelo por defecto y los textos iniciales del codigo", async () => {
    const service = serviceWith(async () => ({
      data: { chat_agent_created: true, chat_agent_id: "a-1", models_set: 2, copywriter_instructions_set: true },
      error: null,
    }));
    const result = await ensureDefaultAgents(service, "ws-1", [
      { provider: "anthropic", defaultModel: "claude-sonnet-5" },
      { provider: "openai", defaultModel: "gpt-5" },
    ]);
    expect((service as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("ensure_default_agents", {
      p_workspace_id: "ws-1",
      p_provider: "anthropic",
      p_model: "claude-sonnet-5",
      p_chat_prompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      p_copywriter_instructions: DEFAULT_COPYWRITER_INSTRUCTIONS,
    });
    expect(result).toEqual({ chatAgentCreated: true, chatAgentId: "a-1", modelsSet: 2, copywriterInstructionsSet: true });
  });

  it("nunca lanza: un error de la base o una excepcion devuelven null", async () => {
    const connected = [{ provider: "openai", defaultModel: "gpt-5" }];
    const failing = serviceWith(async () => ({ data: null, error: { message: "boom" } }));
    const throwing = serviceWith(async () => {
      throw new Error("red caida");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureDefaultAgents(failing, "ws-1", connected)).toBeNull();
    expect(await ensureDefaultAgents(throwing, "ws-1", connected)).toBeNull();
    spy.mockRestore();
  });

  it("los textos iniciales pasan el minimo que exige la base (20 caracteres)", () => {
    expect(DEFAULT_AGENT_SYSTEM_PROMPT.trim().length).toBeGreaterThanOrEqual(20);
    expect(DEFAULT_COPYWRITER_INSTRUCTIONS.trim().length).toBeGreaterThanOrEqual(20);
  });
});
