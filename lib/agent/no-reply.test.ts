import { describe, expect, it } from "vitest";
import { canSkipReply } from "./no-reply";

const v2 = (...kinds: string[]) => ({ v: 2, items: kinds.map((kind) => ({ kind, status: "ready" })) });

describe("canSkipReply", () => {
  it("un gracias se puede dejar sin respuesta", () => {
    expect(canSkipReply([{ text: "gracias!" }])).toBe(true);
  });

  it("una pregunta en cualquier mensaje de la tanda, no", () => {
    expect(canSkipReply([{ text: "genial" }, { text: "¿y cuánto sale?" }])).toBe(false);
  });

  it("una pregunta dentro de un audio transcripto, no", () => {
    expect(canSkipReply([{ text: null, transcript: "hola, cuanto sale?", attachments: v2("voice") }])).toBe(false);
  });

  it("un audio, aunque no tenga pregunta, no", () => {
    expect(canSkipReply([{ text: null, transcript: "gracias", attachments: v2("voice") }])).toBe(false);
  });

  it("una foto, no", () => {
    expect(canSkipReply([{ text: "listo", attachments: v2("image") }])).toBe(false);
  });

  it("un sticker o un GIF, si", () => {
    expect(canSkipReply([{ text: null, attachments: v2("sticker") }, { text: null, attachments: v2("gif") }])).toBe(true);
  });

  it("despues de una promesa nuestra, no (el lead sigue esperando el link)", () => {
    expect(canSkipReply([{ text: "Gracias" }], "Voy a buscar el link para pasartela, dame un momento")).toBe(false);
  });

  it("despues de una pregunta nuestra, no", () => {
    expect(canSkipReply([{ text: "dale" }], "¿Te paso el link?")).toBe(false);
  });

  it("una tanda vacia nunca", () => {
    expect(canSkipReply([])).toBe(false);
  });
});
