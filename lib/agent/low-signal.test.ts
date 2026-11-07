import { describe, it, expect } from "vitest";
import { isLowSignalConversation } from "./low-signal";

const lead = (text: string | null, attachments?: unknown) => ({ direction: "inbound", text, attachments });
const biz = (text: string) => ({ direction: "outbound", text });

const VOICE = { v: 2, items: [{ kind: "voice" }] };
const STICKER = { v: 2, items: [{ kind: "sticker" }] };
const IMAGE = { v: 2, items: [{ kind: "image" }] };

describe("conversacion de poca senal (no se gasta IA)", () => {
  it("el lead nunca escribio: solo hay lo que mando el negocio", () => {
    expect(isLowSignalConversation([biz("Hola! Gracias por el follow"), biz("Espero te sirva!")])).toBe(true);
  });

  it("sin mensajes tampoco hay nada que resumir", () => {
    expect(isLowSignalConversation([])).toBe(true);
  });

  it("el caso real de ManyChat: el lead solo dice que si a la guia", () => {
    expect(isLowSignalConversation([biz("Hola! Gracias por el follow..."), lead("Si enviamelo!"), biz("Aca te comparto la guia")])).toBe(true);
    expect(isLowSignalConversation([lead("Si enviamelo!"), biz("Aca esta"), lead("Muchas gracias!!!")])).toBe(true);
    expect(isLowSignalConversation([lead("Hola. Sí me interesa")])).toBe(true);
    expect(isLowSignalConversation([lead("ok"), biz("Genial")])).toBe(true);
    expect(isLowSignalConversation([lead("Graciassss 🙏")])).toBe(true);
  });

  it("los acentos y las mayusculas no importan", () => {
    expect(isLowSignalConversation([lead("SÍ, ENVÍAMELO")])).toBe(true);
  });

  it("una pregunta, por corta que sea, pide respuesta: sigue al modelo", () => {
    expect(isLowSignalConversation([lead("Si?")])).toBe(false);
    expect(isLowSignalConversation([lead("¿Si")])).toBe(false);
  });

  it("una palabra que no es un si o un gracias es contenido, aunque el mensaje sea corto", () => {
    // Casos reales que un corte por largo habria dejado afuera.
    expect(isLowSignalConversation([lead("no me llego nada")])).toBe(false);
    expect(isLowSignalConversation([lead("Hola wendy, no encuentro el enlace al archivo")])).toBe(false);
    expect(isLowSignalConversation([lead("Hola wen quiero más info de la academia")])).toBe(false);
    expect(isLowSignalConversation([lead("Lo pense mejor y quiero el plan anual")])).toBe(false);
    expect(isLowSignalConversation([lead("Si enviamelo!"), lead("Gracias, lo voy a mirar")])).toBe(false);
  });

  it("una palabra suelta de un tema tampoco se descarta", () => {
    expect(isLowSignalConversation([lead("Academia")])).toBe(false);
  });

  it("mas de dos mensajes del lead es una conversacion de verdad", () => {
    expect(isLowSignalConversation([lead("Si"), lead("Ok"), lead("Gracias")])).toBe(false);
  });

  it("un audio o una foto del lead es contenido, aunque no tenga texto", () => {
    expect(isLowSignalConversation([lead(null, VOICE)])).toBe(false);
    expect(isLowSignalConversation([lead("Si", IMAGE)])).toBe(false);
  });

  it("un sticker no cuenta como contenido", () => {
    expect(isLowSignalConversation([lead(null, STICKER)])).toBe(true);
  });

  it("lo que mando el negocio no cuenta, por largo que sea", () => {
    expect(isLowSignalConversation([biz("Te cuento los detalles del programa y los precios. ".repeat(10)), lead("Si")])).toBe(true);
  });
});
