import { describe, expect, it } from "vitest";
import { canRetrySend, retryMediaFrom, sendErrorText } from "./send-failure";

describe("sendErrorText", () => {
  it("el motivo y que hacer, en una frase", () => {
    expect(sendErrorText({ message: "Instagram no dejo enviar.", hint: "Contestale desde esa app." })).toBe(
      "Instagram no dejo enviar. Contestale desde esa app.",
    );
  });
  it("sin motivo, uno generico", () => {
    expect(sendErrorText(undefined)).toBe("No se pudo enviar el mensaje.");
  });
});

describe("canRetrySend", () => {
  const base = { direction: "outbound", status: "failed", origin: "user", send_error: "motivo" };
  it("un envio fallido de una persona con el motivo aparte", () => {
    expect(canRetrySend(base)).toBe(true);
  });
  it("una fila vieja (el motivo en el texto) no", () => {
    expect(canRetrySend({ ...base, send_error: null })).toBe(false);
  });
  it("lo que mando el agente o un flow no (se reintenta por su propio camino)", () => {
    expect(canRetrySend({ ...base, origin: "agent" })).toBe(false);
  });
  it("lo que ya salio no", () => {
    expect(canRetrySend({ ...base, status: "sent" })).toBe(false);
  });
});

describe("retryMediaFrom", () => {
  it("el primer adjunto guardado", () => {
    expect(
      retryMediaFrom({ v: 2, items: [{ kind: "voice", storagePath: "ws/cv/a.ogg", mime: "audio/ogg", filename: null, durationSeconds: 8, status: "ready" }] }),
    ).toMatchObject({ kind: "voice", storagePath: "ws/cv/a.ogg", mime: "audio/ogg", durationSeconds: 8 });
  });
  it("sin archivo, nada", () => {
    expect(retryMediaFrom(null)).toBeNull();
  });
});
