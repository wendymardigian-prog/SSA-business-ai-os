import { describe, it, expect } from "vitest";
import { groupDedupeKey, groupEventMatches, normalizeEmoji, parseGroupTriggerConfig } from "./trigger-config";
import { joinedPayload, pollVotePayload, reactionPayload } from "./payload";

const group = { id: "g-1", group_jid: "120363001122334455@g.us", subject: "Comunidad", channel_id: "ch-1" };
const businessMsg = { id: "m-1", text: "¿Quién viene?", direction: "outbound" as const, sent_by_flow_id: "f-1", sent_by_node_id: "n-1" };
const memberMsg = { ...businessMsg, id: "m-2", direction: "inbound" as const, sent_by_flow_id: null, sent_by_node_id: null };

describe("parseGroupTriggerConfig", () => {
  it("sin nada: cualquier grupo; reacciones a mensajes del negocio, votos a cualquier encuesta", () => {
    expect(parseGroupTriggerConfig("whatsapp_group_reaction", undefined)).toMatchObject({ groupIds: [], messageScope: "business", emojis: [] });
    expect(parseGroupTriggerConfig("whatsapp_group_poll_vote", {})).toMatchObject({ messageScope: "any", options: [] });
  });

  it("una config rota no dispara", () => {
    expect(parseGroupTriggerConfig("whatsapp_group_joined", { group_ids: "g-1" })).toBeNull();
    expect(parseGroupTriggerConfig("whatsapp_group_reaction", { message_scope: "otra" })).toBeNull();
    expect(parseGroupTriggerConfig("whatsapp_group_reaction", { message_scope: "picked", message_ids: [] })).toBeNull();
    expect(parseGroupTriggerConfig("whatsapp_group_reaction", { message_scope: "flow_step", flow_step: { flowId: "f" } })).toBeNull();
    expect(groupEventMatches("whatsapp_group_joined", { group_ids: 3 }, joinedPayload(group, "p"))).toBe(false);
  });
});

describe("se unio a un grupo", () => {
  it("cualquier grupo, o solo los elegidos", () => {
    expect(groupEventMatches("whatsapp_group_joined", {}, joinedPayload(group, "p"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_joined", { group_ids: ["g-1"] }, joinedPayload(group, "p"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_joined", { group_ids: ["g-2"] }, joinedPayload(group, "p"))).toBe(false);
  });

  it("una vez por persona y grupo", () => {
    expect(groupDedupeKey("whatsapp_group_joined", {}, joinedPayload(group, "p"), "c-1", "e-1")).toBe("wa-join:g-1:c-1");
  });
});

describe("reacciono a un mensaje", () => {
  it("por defecto, solo a mensajes del negocio", () => {
    expect(groupEventMatches("whatsapp_group_reaction", {}, reactionPayload(group, "p", businessMsg, "🔥"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_reaction", {}, reactionPayload(group, "p", memberMsg, "🔥"))).toBe(false);
    expect(groupEventMatches("whatsapp_group_reaction", { message_scope: "any" }, reactionPayload(group, "p", memberMsg, "🔥"))).toBe(true);
  });

  it("un mensaje elegido, o los que mando un paso", () => {
    expect(groupEventMatches("whatsapp_group_reaction", { message_scope: "picked", message_ids: ["m-1"] }, reactionPayload(group, "p", businessMsg, "🔥"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_reaction", { message_scope: "picked", message_ids: ["m-9"] }, reactionPayload(group, "p", businessMsg, "🔥"))).toBe(false);
    expect(groupEventMatches("whatsapp_group_reaction", { message_scope: "flow_step", flow_step: { flowId: "f-1", nodeId: "n-1" } }, reactionPayload(group, "p", businessMsg, "🔥"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_reaction", { message_scope: "flow_step", flow_step: { flowId: "f-1", nodeId: "n-2" } }, reactionPayload(group, "p", businessMsg, "🔥"))).toBe(false);
  });

  it("filtra por emoji, sin importar el selector de variante", () => {
    expect(normalizeEmoji("❤️")).toBe("❤");
    expect(groupEventMatches("whatsapp_group_reaction", { emojis: ["❤️"] }, reactionPayload(group, "p", businessMsg, "❤"))).toBe(true);
    expect(groupEventMatches("whatsapp_group_reaction", { emojis: ["🔥", "👍"] }, reactionPayload(group, "p", businessMsg, "😂"))).toBe(false);
    expect(groupEventMatches("whatsapp_group_reaction", {}, reactionPayload(group, "p", businessMsg, ""))).toBe(false);
  });

  it("una vez por persona y mensaje, aunque cambie de emoji", () => {
    expect(groupDedupeKey("whatsapp_group_reaction", {}, reactionPayload(group, "p", businessMsg, "🔥"), "c-1", "e-1")).toBe(
      groupDedupeKey("whatsapp_group_reaction", {}, reactionPayload(group, "p", businessMsg, "👍"), "c-1", "e-2"),
    );
  });
});

describe("voto en una encuesta", () => {
  const poll = { name: "¿Qué día?" };
  const vote = (selected: string[]) => pollVotePayload(group, "p", businessMsg, poll, selected);

  it("cualquier opcion, o alguna de las elegidas (sin mayusculas ni espacios)", () => {
    expect(groupEventMatches("whatsapp_group_poll_vote", {}, vote(["Martes"]))).toBe(true);
    expect(groupEventMatches("whatsapp_group_poll_vote", { options: ["lunes "] }, vote(["Lunes", "Martes"]))).toBe(true);
    expect(groupEventMatches("whatsapp_group_poll_vote", { options: ["Lunes"] }, vote(["Martes"]))).toBe(false);
    expect(groupEventMatches("whatsapp_group_poll_vote", {}, vote([]))).toBe(false);
  });

  it("sin filtro: una vez por persona y encuesta; con filtro: cambiar a otra opcion que coincide vuelve a disparar", () => {
    expect(groupDedupeKey("whatsapp_group_poll_vote", {}, vote(["Lunes"]), "c-1", "e")).toBe(groupDedupeKey("whatsapp_group_poll_vote", {}, vote(["Martes"]), "c-1", "e"));
    const config = { options: ["Lunes", "Martes"] };
    expect(groupDedupeKey("whatsapp_group_poll_vote", config, vote(["Lunes"]), "c-1", "e")).not.toBe(groupDedupeKey("whatsapp_group_poll_vote", config, vote(["Martes"]), "c-1", "e"));
  });
});
