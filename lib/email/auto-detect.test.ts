/**
 * Detectar correos automaticos (F63).
 */

import { describe, it, expect } from "vitest";
import { detectAutomatic } from "./auto-detect";

describe("correos automaticos (F63)", () => {
  it("Auto-Submitted distinto de no es automatico por definicion", () => {
    expect(detectAutomatic({ raw: { "Auto-Submitted": "auto-replied" } })).toMatchObject({
      automatic: true,
    });
  });

  it("Auto-Submitted: no es una persona", () => {
    expect(detectAutomatic({ raw: { "auto-submitted": "no" } }).automatic).toBe(false);
  });

  it("Precedence bulk, list o auto_reply", () => {
    for (const value of ["bulk", "list", "auto_reply"]) {
      expect(detectAutomatic({ raw: { Precedence: value } }).automatic).toBe(true);
    }
  });

  it("una lista de correo es un boletin, no alguien escribiendo", () => {
    expect(detectAutomatic({ raw: { "List-Unsubscribe": "<mailto:x>" } }).automatic).toBe(true);
    expect(detectAutomatic({ raw: { "list-id": "<news.x.com>" } }).automatic).toBe(true);
  });

  it("los remitentes que nunca son una persona", () => {
    for (const from of [
      "no-reply@banco.com",
      "MAILER-DAEMON@mail.google.com",
      "postmaster@dominio.com",
      "noreply@x.io",
    ]) {
      expect(detectAutomatic({ from }).automatic, from).toBe(true);
    }
  });

  it("un email normal no se marca", () => {
    expect(
      detectAutomatic({ from: "ana@clienta.com", subject: "Consulta", raw: { "Message-ID": "<1>" } }),
    ).toEqual({ automatic: false, reason: null });
  });

  it("dice por que, para el log y la pantalla", () => {
    expect(detectAutomatic({ from: "no-reply@x.com" }).reason).toContain("no-reply");
  });

  it("las cabeceras se leen sin importar mayusculas", () => {
    expect(detectAutomatic({ raw: { PRECEDENCE: "BULK" } }).automatic).toBe(true);
  });
});
