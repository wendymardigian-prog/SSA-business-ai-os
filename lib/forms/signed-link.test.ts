import { describe, it, expect } from "vitest";
import { createToken, readToken } from "./signed-link";

const SECRET = "secreto-de-prueba-del-workspace";
const FORM = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const SALE = "44444444-4444-4444-8444-444444444444";
const NOW = Date.UTC(2026, 9, 10);

const make = (extra: Partial<Parameters<typeof createToken>[0]> = {}) => createToken({ formId: FORM, contactId: CONTACT, now: NOW, ...extra }, SECRET);

describe("createToken / readToken", () => {
  it("un token válido devuelve los tres ids, firmados", () => {
    const token = make({ serviceId: SERVICE, saleId: SALE });
    const read = readToken(token, SECRET, { formId: FORM, now: NOW + 1000 });
    expect(read.ok && read.payload).toMatchObject({ f: FORM, c: CONTACT, s: SERVICE, o: SALE });
  });

  it("service_id y sale_id son opcionales", () => {
    const read = readToken(make(), SECRET, { formId: FORM, now: NOW });
    expect(read.ok && read.payload.s).toBeUndefined();
    expect(read.ok && read.payload.o).toBeUndefined();
  });

  it("el id del servicio NO aparece en claro en la URL: viaja dentro del token codificado", () => {
    const token = make({ serviceId: SERVICE });
    expect(token).not.toContain(SERVICE);
    expect(`https://app.x/f/como-vas?c=${token}`).not.toContain(SERVICE);
  });

  it("la firma alterada en un byte es inválida", () => {
    const token = make();
    const [body, sig] = token.split(".");
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(readToken(`${body}.${flipped}`, SECRET, { formId: FORM, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("el payload cambiado (otro service_id) con la firma vieja es inválido", () => {
    const [body, sig] = make({ serviceId: SERVICE }).split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.s = "55555555-5555-4555-8555-555555555555";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(readToken(forged, SECRET, { formId: FORM, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("vencido a los 60 días", () => {
    const token = make();
    expect(readToken(token, SECRET, { formId: FORM, now: NOW + 59 * 86_400_000 }).ok).toBe(true);
    expect(readToken(token, SECRET, { formId: FORM, now: NOW + 61 * 86_400_000 })).toEqual({ ok: false, reason: "expired" });
  });

  it("un token de otro formulario no sirve", () => {
    expect(readToken(make(), SECRET, { formId: "99999999-9999-4999-8999-999999999999", now: NOW })).toEqual({ ok: false, reason: "form" });
  });

  it("firmado con otro secreto (otro workspace) no sirve", () => {
    expect(readToken(make(), "otro-secreto", { formId: FORM, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("basura, vacío y demasiado largo dan formato inválido sin lanzar", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "x".repeat(2000), "%%%.%%%"]) {
      const read = readToken(bad, SECRET, { formId: FORM, now: NOW });
      expect(read.ok, bad.slice(0, 10)).toBe(false);
    }
  });

  it("ids que no son UUID (aunque estén bien firmados) se rechazan", () => {
    const token = createToken({ formId: FORM, contactId: "no-es-uuid", now: NOW }, SECRET);
    expect(readToken(token, SECRET, { formId: FORM, now: NOW })).toEqual({ ok: false, reason: "ids" });
    const badSale = createToken({ formId: FORM, contactId: CONTACT, saleId: "x", now: NOW }, SECRET);
    expect(readToken(badSale, SECRET, { formId: FORM, now: NOW })).toEqual({ ok: false, reason: "ids" });
  });

  it("una versión desconocida del token se rechaza", () => {
    const body = Buffer.from(JSON.stringify({ v: 2, f: FORM, c: CONTACT, e: 9_999_999_999 })).toString("base64url");
    const sig = Buffer.from("x").toString("base64url");
    expect(readToken(`${body}.${sig}`, SECRET, { formId: FORM, now: NOW }).ok).toBe(false);
  });
});
