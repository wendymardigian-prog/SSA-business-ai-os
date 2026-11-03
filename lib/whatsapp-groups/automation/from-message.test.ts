import { describe, it, expect } from "vitest";
import { automationFromMessage } from "./from-message";

describe("automationFromMessage", () => {
  it("una reaccion a ese mensaje, con los emojis elegidos", () => {
    const r = automationFromMessage({ kind: "reaction", groupId: "g-1", messageId: "m-1", emojis: ["🔥", "❤️", "🔥"] }, { groupName: "Comunidad", messageLabel: "¿Quién viene?" });
    expect(r.triggerType).toBe("whatsapp_group_reaction");
    expect(r.name).toBe("Reacción en Comunidad: ¿Quién viene?");
    expect(r.nodes[0].data).toEqual({ triggerType: "whatsapp_group_reaction", group_ids: ["g-1"], message_scope: "picked", message_ids: ["m-1"], emojis: ["🔥", "❤"] });
  });

  it("un voto en esa encuesta: sin opciones = cualquiera", () => {
    const r = automationFromMessage({ kind: "poll_vote", groupId: "g-1", messageId: "m-2", options: [" "] }, { groupName: "G", messageLabel: "📊 ¿Qué día?" });
    expect(r.nodes[0].data).toEqual({ triggerType: "whatsapp_group_poll_vote", group_ids: ["g-1"], message_scope: "picked", message_ids: ["m-2"] });
  });

  it("el nombre no pasa de 80 caracteres", () => {
    expect(automationFromMessage({ kind: "reaction", groupId: "g", messageId: "m" }, { groupName: "G", messageLabel: "x".repeat(200) }).name).toHaveLength(80);
  });
});
