import { describe, it, expect } from "vitest";
import { matchTrigger } from "./trigger-matcher";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { agentRow } from "@/lib/agent/testing/fixtures";

/**
 * La puerta "solo si el agente de IA esta apagado" (Fase 3, F32).
 *
 * El caso que la motivo: un flow con trigger por defecto matchea TODOS los
 * mensajes, y como la automatizacion tiene prioridad, el agente nunca
 * contestaria. El trigger por defecto se devolvia antes de pasar por ninguna
 * puerta; este test fija que ahora si pasa.
 */

function world(agentEnabledInConversation: boolean, onlyIfAgentOff: boolean) {
  const trigger = {
    id: "tr-default",
    flow_id: "flow-1",
    channel_id: null,
    type: "default",
    config: onlyIfAgentOff ? { only_if_agent_off: true } : {},
    priority: 0,
    is_active: true,
  };
  const db = memoryDb({
    triggers: [trigger],
    agents: [agentRow({ enabled_channel_ids: ["ch-1"] })],
    conversations: [{ id: "cv-1", channel_id: "ch-1", agent_enabled: agentEnabledInConversation, agent_paused_until: null }],
  });
  return db;
}

const args = { channelId: "ch-1", workspaceId: "ws-1", conversationId: "cv-1", message: { text: "hola" }, isFirstMessage: false };

describe("trigger por defecto con 'solo si el agente esta apagado'", () => {
  it("con el agente activo en la conversacion, el flow NO arranca: el mensaje queda para el agente", async () => {
    expect(await matchTrigger(world(true, true).client, args)).toBeNull();
  });

  it("con el agente apagado en la conversacion, el flow arranca como siempre", async () => {
    expect(await matchTrigger(world(false, true).client, args)).toMatchObject({ id: "tr-default" });
  });

  it("sin la puerta, el trigger por defecto sigue capturando todo (comportamiento de la Fase 2)", async () => {
    expect(await matchTrigger(world(true, false).client, args)).toMatchObject({ id: "tr-default" });
  });
});
