import { describe, it, expect } from "vitest";
import { parseBaileysPollVote } from "./poll-votes";

const vote = (selectedOptions: unknown, id: unknown = "poll-1") => ({
  pollUpdateMessage: { pollCreationMessageKey: { remoteJid: "123@g.us", fromMe: true, id }, vote: { selectedOptions } },
});

describe("parseBaileysPollVote", () => {
  it("un mensaje comun, una reaccion o nada no son un voto", () => {
    expect(parseBaileysPollVote({ conversation: "hola" })).toBeNull();
    expect(parseBaileysPollVote({ reactionMessage: { key: { id: "x" }, text: "👍" } })).toBeNull();
    expect(parseBaileysPollVote(null)).toBeNull();
    expect(parseBaileysPollVote("texto")).toBeNull();
  });

  it("un voto descifrado trae los nombres de las opciones", () => {
    expect(parseBaileysPollVote(vote(["Lunes", "Martes"]))).toEqual({ pollMessageId: "poll-1", selectedOptions: ["Lunes", "Martes"], decrypted: true });
  });

  it("limpia espacios y repetidos", () => {
    expect(parseBaileysPollVote(vote([" Lunes ", "Lunes", ""]))?.selectedOptions).toEqual(["Lunes"]);
  });

  it("una lista vacia es 'saco su voto': descifrado y sin nada elegido", () => {
    expect(parseBaileysPollVote(vote([]))).toEqual({ pollMessageId: "poll-1", selectedOptions: [], decrypted: true });
  });

  it("un voto cifrado (Evolution no tenia la encuesta) se reconoce como voto pero sin opciones", () => {
    const encrypted = { pollUpdateMessage: { pollCreationMessageKey: { id: "poll-1" }, vote: { encPayload: "abc", encIv: "def" } } };
    expect(parseBaileysPollVote(encrypted)).toEqual({ pollMessageId: "poll-1", selectedOptions: [], decrypted: false });
    expect(parseBaileysPollVote(vote([{ 0: 1 }]))?.decrypted).toBe(false);
  });

  it("sin id de la encuesta igual es un voto (el id queda vacio)", () => {
    expect(parseBaileysPollVote(vote(["Lunes"], null))?.pollMessageId).toBe("");
  });
});
