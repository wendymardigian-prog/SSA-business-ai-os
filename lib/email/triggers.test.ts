/**
 * El trigger "email recibido" en los flows (F67).
 */

import { describe, it, expect } from "vitest";
import { emailMatches, EMAIL_TRIGGER } from "./triggers";

describe("si el correo dispara el flow (F67)", () => {
  it("sin filtro, cualquier asunto", () => {
    expect(emailMatches({}, { subject: "Consulta" })).toBe(true);
    expect(emailMatches({ subjectContains: null }, { subject: null })).toBe(true);
  });

  it("con filtro, solo los que lo contienen", () => {
    // Sin el filtro, el flow correria con cada correo que entre, incluidos
    // los que no tienen nada que ver.
    expect(emailMatches({ subjectContains: "presupuesto" }, { subject: "Pido presupuesto" })).toBe(true);
    expect(emailMatches({ subjectContains: "presupuesto" }, { subject: "Consulta" })).toBe(false);
  });

  it("el filtro no distingue mayusculas", () => {
    expect(emailMatches({ subjectContains: "PRESUPUESTO" }, { subject: "pido presupuesto" })).toBe(true);
  });

  it("un correo sin asunto no matchea un filtro con texto", () => {
    expect(emailMatches({ subjectContains: "algo" }, { subject: null })).toBe(false);
  });

  it("un filtro de solo espacios cuenta como sin filtro", () => {
    expect(emailMatches({ subjectContains: "   " }, { subject: "Cualquier cosa" })).toBe(true);
  });

  it("el tipo del trigger es el que acepta el CHECK de la base", () => {
    expect(EMAIL_TRIGGER).toBe("email_received");
  });
});
