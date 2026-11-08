import { describe, it, expect } from "vitest";
import { buildThread, participantLabel } from "./thread";

const base = { reactions: [], votes: [], members: [], contacts: {} };
const msg = (over: Record<string, unknown>) => ({
  id: "m",
  direction: "inbound",
  sender_participant_id: "+5491122334455",
  sender_name: null,
  text: "hola",
  attachments: null,
  poll: null,
  origin: "external",
  status: "sent",
  send_error: null,
  created_at: "2026-11-03T10:00:00Z",
  ...over,
});

describe("participantLabel", () => {
  it("contacto, despues el nombre de WhatsApp, el miembro y el telefono", () => {
    const input = { members: [{ participant_id: "p2", display_name: "Miembro", phone: "+54911" }], contacts: { p1: { id: "c1", name: "Ana Contacto" } } };
    expect(participantLabel(input, "p1", "Ana WA")).toBe("Ana Contacto");
    expect(participantLabel(input, "p2", "Pepe WA")).toBe("Pepe WA");
    expect(participantLabel(input, "p2")).toBe("Miembro");
    expect(participantLabel({ members: [], contacts: {} }, "+5491100000000")).toBe("+5491100000000");
    expect(participantLabel({ members: [], contacts: {} }, "123@lid")).toBe("Alguien del grupo");
    expect(participantLabel({ members: [], contacts: {} }, "me")).toBe("Vos");
  });
});

describe("buildThread", () => {
  it("ordena por fecha, nombra a quien escribe y cuenta reacciones vigentes", () => {
    const thread = buildThread({
      ...base,
      messages: [msg({ id: "b", created_at: "2026-11-03T11:00:00Z", direction: "outbound", sender_participant_id: null }), msg({ id: "a", sender_name: "Ana" })],
      reactions: [
        { message_id: "b", participant_id: "p1", emoji: "🔥", removed_at: null },
        { message_id: "b", participant_id: "p2", emoji: "🔥", removed_at: null },
        { message_id: "b", participant_id: "p3", emoji: "👍", removed_at: "2026-11-03T12:00:00Z" },
      ],
    });
    expect(thread.map((m) => m.id)).toEqual(["a", "b"]);
    expect(thread[0].senderLabel).toBe("Ana");
    expect(thread[1].senderLabel).toBeNull();
    expect(thread[1].reactions).toEqual([{ emoji: "🔥", count: 2 }]);
  });

  it("una encuesta con sus votos por opcion y quien voto", () => {
    const [m] = buildThread({
      ...base,
      contacts: { p1: { id: "c1", name: "Ana" } },
      messages: [msg({ id: "poll", direction: "outbound", text: null, poll: { name: "¿Qué día?", options: ["Lunes", "Martes"], selectableCount: 0 } })],
      votes: [
        { message_id: "poll", participant_id: "p1", selected_options: ["Lunes", "Martes"] },
        { message_id: "poll", participant_id: "+5491199", selected_options: ["Lunes"] },
        { message_id: "poll", participant_id: "p3", selected_options: [] },
      ],
    });
    expect(m.poll).toEqual({
      name: "¿Qué día?",
      multiple: true,
      totalVoters: 2,
      options: [
        { name: "Lunes", count: 2, voters: [{ name: "+5491199", contactId: null }, { name: "Ana", contactId: "c1" }] },
        { name: "Martes", count: 1, voters: [{ name: "Ana", contactId: "c1" }] },
      ],
    });
  });
});

describe("quién votó una encuesta", () => {
  it("cada votante lleva su contacto si lo hay; «Vos» va primero y el resto en orden alfabético", () => {
    const [m] = buildThread({
      ...base,
      contacts: { p1: { id: "c1", name: "Zoe" }, p2: { id: "c2", name: "Bruno" } },
      messages: [msg({ id: "poll", direction: "outbound", text: null, poll: { name: "¿Venís?", options: ["Sí", "No"], selectableCount: 1 } })],
      votes: [
        { message_id: "poll", participant_id: "p1", selected_options: ["Sí"] },
        { message_id: "poll", participant_id: "me", selected_options: ["Sí"] },
        { message_id: "poll", participant_id: "p2", selected_options: ["Sí"] },
      ],
    });
    expect(m.poll?.options[0].voters).toEqual([
      { name: "Vos", contactId: null },
      { name: "Bruno", contactId: "c2" },
      { name: "Zoe", contactId: "c1" },
    ]);
    expect(m.poll?.options[1]).toEqual({ name: "No", count: 0, voters: [] });
  });
});
