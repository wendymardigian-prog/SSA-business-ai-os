import { describe, expect, it } from "vitest";
import {
  EMAIL_SUBJECT_LIMIT,
  byteLength,
  checkTextLimit,
  graphemeCount,
  limitMessage,
  messageTextLimit,
} from "@/lib/channels/text-limits";

const FAMILY = "👨‍👩‍👧"; // compuesto: 3 emojis unidos
const HEART = "❤️";
const FLAG = "🇦🇷";

describe("conteo de emojis", () => {
  it("un emoji compuesto es un grafema, aunque pese muchos bytes", () => {
    expect(graphemeCount(FAMILY)).toBe(1);
    expect(graphemeCount(FLAG)).toBe(1);
    expect(graphemeCount(`hola ${HEART}`)).toBe(6);
    expect(byteLength(FAMILY)).toBe(18);
  });

  it("los acentos y la enie no se parten", () => {
    expect(graphemeCount("canción niño")).toBe(12);
  });
});

describe("topes por canal", () => {
  it("Instagram cuenta bytes: 250 emojis simples no entran, 250 letras si", () => {
    const limit = messageTextLimit("zernio");
    expect(limit).toEqual({ max: 1000, kind: "bytes" });
    expect(checkTextLimit("a".repeat(250), limit).ok).toBe(true);
    expect(checkTextLimit("😀".repeat(251), limit).ok).toBe(false);
    expect(checkTextLimit("😀".repeat(250), limit).ok).toBe(true);
  });

  it("WhatsApp cuenta unidades UTF-16 (un emoji simple vale 2)", () => {
    const limit = messageTextLimit("evolution");
    expect(checkTextLimit("😀".repeat(2048), limit).ok).toBe(true);
    expect(checkTextLimit("😀".repeat(2049), limit).ok).toBe(false);
  });

  it("el email y un canal desconocido no tienen tope de cuerpo", () => {
    expect(messageTextLimit("resend")).toBeNull();
    expect(messageTextLimit("otro")).toBeNull();
    expect(checkTextLimit("x".repeat(100000), null).ok).toBe(true);
  });

  it("el asunto avisa pasados 78 caracteres", () => {
    expect(checkTextLimit("a".repeat(78), EMAIL_SUBJECT_LIMIT).ok).toBe(true);
    expect(checkTextLimit("a".repeat(79), EMAIL_SUBJECT_LIMIT).ok).toBe(false);
  });

  it("el mensaje de error nombra la unidad", () => {
    const check = checkTextLimit("😀".repeat(300), messageTextLimit("zernio"));
    expect(limitMessage(check)).toMatch(/bytes/);
    expect(limitMessage({ ok: true, used: 1, max: 2, kind: "utf16" })).toBeNull();
  });
});

describe("ida y vuelta", () => {
  it("un texto con emojis sobrevive a JSON (como se guarda en data de un nodo)", () => {
    const text = `Hola 😀 ${FAMILY} ${HEART} ${FLAG}`;
    expect(JSON.parse(JSON.stringify({ text })).text).toBe(text);
  });
});
