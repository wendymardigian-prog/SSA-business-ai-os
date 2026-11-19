import { describe, expect, it, vi } from "vitest";
import { buildToolSet } from "./build";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import type { AgentToolContext } from "./types";

/**
 * Modo «proponer»: en un turno en borrador, una herramienta que escribe en el CRM no se ejecuta; queda una
 * propuesta para que una persona la apruebe. Con el interruptor apagado, todo sigue como antes.
 */

function ctxFor(over: { actionsNeedApproval: boolean; mode: "send" | "draft" }) {
  const run = { runId: "run-1", step: vi.fn(async () => null), setModel: vi.fn() };
  const propose = vi.fn(async () => ({ id: "prop-1" }));
  const supabase = { from: vi.fn(() => { throw new Error("no debería tocar la base"); }) };
  const agent = toAgentConfig(agentRow({ actions_need_approval: over.actionsNeedApproval, allowed_tools: ["cambiar_temperatura"] }));
  const ctx = {
    supabase: supabase as never,
    agent,
    workspaceId: "ws-1",
    conversationId: "conv-1",
    contactId: "c-1",
    channelId: "ch-1",
    run: run as never,
    nonce: "n",
    mode: over.mode,
    propose,
  } satisfies AgentToolContext;
  return { ctx, run, propose, supabase };
}

async function callTemperature(ctx: AgentToolContext) {
  const built = await buildToolSet(ctx);
  const t = built.tools.cambiar_temperatura as { execute: (input: unknown, opts: unknown) => Promise<unknown> };
  const out = await t.execute({ temperatura: "hot", motivo: "Quiere empezar ya" }, { toolCallId: "x", messages: [] });
  return { built, out };
}

describe("modo proponer", () => {
  it("en borrador con aprobación de acciones: deja una propuesta y no escribe en el CRM", async () => {
    const { ctx, propose, supabase } = ctxFor({ actionsNeedApproval: true, mode: "draft" });
    const { built, out } = await callTemperature(ctx);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ toolKey: "cambiar_temperatura", input: { temperatura: "hot", motivo: "Quiere empezar ya" } }));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(built.state.proposed).toEqual([{ id: "prop-1", tool: "cambiar_temperatura", label: "Cambiar temperatura del lead" }]);
    expect(String(out)).toContain("propuesto");
  });

  it("con el interruptor apagado, en borrador se ejecuta como antes", async () => {
    const { ctx, propose, supabase } = ctxFor({ actionsNeedApproval: false, mode: "draft" });
    await callTemperature(ctx).catch(() => undefined);
    expect(propose).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalled();
  });

  it("en envío directo nunca propone (los canales legacy siguen igual)", async () => {
    const { ctx, propose, supabase } = ctxFor({ actionsNeedApproval: true, mode: "send" });
    await callTemperature(ctx).catch(() => undefined);
    expect(propose).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalled();
  });
});
