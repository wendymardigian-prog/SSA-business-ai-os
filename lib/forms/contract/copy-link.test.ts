import { describe, expect, it } from "vitest";
import { copyDownloadPath, createCopyToken, readCopyToken } from "./copy-link";

const SECRET = "secreto-de-prueba";
const SUB = "11111111-2222-4333-8444-555555555555";
const FORM = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-10-21T12:00:00Z");

describe("link de la copia firmada", () => {
  it("un token recién hecho sirve para su respuesta y su formulario", () => {
    const token = createCopyToken({ submissionId: SUB, formId: FORM, now: NOW }, SECRET);
    expect(readCopyToken(token, SECRET, { formId: FORM, now: NOW + 60_000 })).toEqual({ ok: true, submissionId: SUB });
  });

  it("vence a las 24 horas", () => {
    const token = createCopyToken({ submissionId: SUB, formId: FORM, now: NOW }, SECRET);
    expect(readCopyToken(token, SECRET, { formId: FORM, now: NOW + 23 * 3_600_000 }).ok).toBe(true);
    expect(readCopyToken(token, SECRET, { formId: FORM, now: NOW + 24 * 3_600_000 + 1000 }).ok).toBe(false);
  });

  it("no sirve en otro formulario, con otra clave ni alterado", () => {
    const token = createCopyToken({ submissionId: SUB, formId: FORM, now: NOW }, SECRET);
    expect(readCopyToken(token, SECRET, { formId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000000", now: NOW }).ok).toBe(false);
    expect(readCopyToken(token, "otra-clave", { formId: FORM, now: NOW }).ok).toBe(false);
    // Cambiar la respuesta adentro del token rompe la firma.
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, s: "99999999-2222-4333-8444-555555555555", f: FORM, e: 9_999_999_999 })).toString("base64url");
    expect(readCopyToken(`${forged}.${sig}`, SECRET, { formId: FORM, now: NOW }).ok).toBe(false);
  });

  it("basura o nada no sirven y no lanzan", () => {
    for (const bad of [null, undefined, "", "abc", "a.b.c", "x".repeat(700), "%%%.###"]) {
      expect(readCopyToken(bad, SECRET, { formId: FORM, now: NOW }).ok).toBe(false);
    }
  });

  it("la dirección del botón lleva el token codificado", () => {
    expect(copyDownloadPath("mi-contrato", "a.b")).toBe("/api/public/forms/mi-contrato/copy?t=a.b");
  });
});
