import { describe, expect, it } from "vitest";
import { conversationListPreview, EMPTY_PREVIEW } from "./last-message";

describe("conversationListPreview", () => {
  it("un mensaje nuestro arranca con 'Vos:'", () => {
    expect(conversationListPreview({ last_message_preview: "Espero te sirva!", last_message_direction: "outbound" })).toBe(
      "Vos: Espero te sirva!",
    );
  });

  it("un mensaje del contacto va tal cual", () => {
    expect(conversationListPreview({ last_message_preview: "Si enviamelo!", last_message_direction: "inbound" })).toBe("Si enviamelo!");
  });

  it("sin direccion conocida (una fila vieja) va tal cual", () => {
    expect(conversationListPreview({ last_message_preview: "Hola", last_message_direction: null })).toBe("Hola");
    expect(conversationListPreview({ last_message_preview: "Hola" })).toBe("Hola");
  });

  it("sin texto dice que no hay mensajes, sin 'Vos:' suelto", () => {
    expect(conversationListPreview({ last_message_preview: null, last_message_direction: "outbound" })).toBe(EMPTY_PREVIEW);
    expect(conversationListPreview({ last_message_preview: "   ", last_message_direction: "outbound" })).toBe(EMPTY_PREVIEW);
  });
});
