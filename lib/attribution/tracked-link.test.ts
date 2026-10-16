import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  MAX_DESTINATION_LENGTH,
  TRACKED_LINK_TTL_DAYS,
  peekTrackedLinkWorkspace,
  safeRedirectTarget,
  signTrackedLink,
  verifyTrackedLink,
} from "./tracked-link";

const SECRET = "secreto-de-prueba-del-workspace";
const W = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const F = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const S = "55555555-5555-4555-8555-555555555555";
const DEST = "https://example.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f";
const NOW = Date.UTC(2026, 9, 15);
const DAY = 86_400_000;

const make = (extra: Partial<Parameters<typeof signTrackedLink>[0]> = {}) => signTrackedLink({ w: W, c: C, u: DEST, f: F, p: P, s: S, ...extra }, SECRET, NOW);

/** Firma a mano un payload cualquiera con el secreto bueno (para probar payloads que `signTrackedLink` no deja armar). */
function forge(payload: unknown, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest().toString("base64url")}`;
}

describe("signTrackedLink / verifyTrackedLink", () => {
  it("un token valido devuelve todo lo firmado", () => {
    const read = verifyTrackedLink(make(), SECRET, NOW + 1000);
    expect(read).toEqual({
      ok: true,
      payload: { v: 1, w: W, c: C, u: DEST, f: F, p: P, s: S, e: Math.floor((NOW + TRACKED_LINK_TTL_DAYS * DAY) / 1000) },
    });
  });

  it("la pieza y la publicacion son opcionales: quedan en null", () => {
    const read = verifyTrackedLink(make({ p: undefined, s: null }), SECRET, NOW);
    expect(read.ok && read.payload.p).toBeNull();
    expect(read.ok && read.payload.s).toBeNull();
  });

  it("tiene la forma base64url(JSON).base64url(HMAC)", () => {
    const token = make();
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [body, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(body, "base64url").toString("utf8")).v).toBe(1);
    expect(Buffer.from(sig, "base64url")).toHaveLength(32);
  });

  it("vence a los 180 dias", () => {
    const token = make();
    expect(verifyTrackedLink(token, SECRET, NOW + 179 * DAY).ok).toBe(true);
    const old = verifyTrackedLink(token, SECRET, NOW + 181 * DAY);
    expect(old).toEqual({ ok: false, reason: "expired", destination: DEST });
  });

  it("un token vencido (firma valida) ofrece el destino para redirigir igual", () => {
    const expired = make({ e: Math.floor(NOW / 1000) - 10 });
    expect(verifyTrackedLink(expired, SECRET, NOW)).toEqual({ ok: false, reason: "expired", destination: DEST });
  });

  it("la firma alterada es invalida y NO ofrece destino (seria un open redirect)", () => {
    const [body, sig] = make().split(".");
    const flipped = `${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    const read = verifyTrackedLink(`${body}.${flipped}`, SECRET, NOW);
    expect(read).toEqual({ ok: false, reason: "signature" });
    expect(read).not.toHaveProperty("destination");
  });

  it("un payload cambiado (otro destino) con la firma vieja es invalido y no ofrece el destino nuevo", () => {
    const [body, sig] = make().split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.u = "https://malo.example/robo";
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const read = verifyTrackedLink(tampered, SECRET, NOW);
    expect(read).toEqual({ ok: false, reason: "signature" });
  });

  it("otro contacto en el payload con la firma vieja es invalido", () => {
    const [body, sig] = make().split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.c = "66666666-6666-4666-8666-666666666666";
    expect(verifyTrackedLink(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`, SECRET, NOW)).toMatchObject({ ok: false, reason: "signature" });
  });

  it("firmado con otro secreto: invalido", () => {
    expect(verifyTrackedLink(make(), "otro-secreto", NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("sin secreto (nunca se firmo nada en el workspace): invalido", () => {
    for (const secret of [null, undefined, ""]) {
      expect(verifyTrackedLink(make(), secret, NOW), String(secret)).toEqual({ ok: false, reason: "signature" });
    }
  });

  it("basura, vacio, demasiado largo o sin punto: formato, sin lanzar", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "a.", ".b", "no-es-token", "x".repeat(5000), null, undefined, 42, {}]) {
      const read = verifyTrackedLink(bad, SECRET, NOW);
      expect(read.ok, String(bad)).toBe(false);
      expect(read).not.toHaveProperty("destination");
    }
  });

  it("un cuerpo que no es JSON, o JSON de otra forma, es formato", () => {
    const sign = (body: string) => `${body}.${createHmac("sha256", SECRET).update(body).digest().toString("base64url")}`;
    expect(verifyTrackedLink(sign(Buffer.from("no json").toString("base64url")), SECRET, NOW)).toEqual({ ok: false, reason: "format" });
    expect(verifyTrackedLink(sign(Buffer.from("[1,2]").toString("base64url")), SECRET, NOW)).toEqual({ ok: false, reason: "format" });
    expect(verifyTrackedLink(forge({ v: 2, w: W }), SECRET, NOW)).toEqual({ ok: false, reason: "format" });
  });

  it("firmado pero con un destino que no es http(s): payload invalido, sin destino", () => {
    const bad = forge({ v: 1, w: W, c: C, u: "javascript:alert(1)", f: F, p: null, s: null, e: Math.floor(NOW / 1000) + 1000 });
    const read = verifyTrackedLink(bad, SECRET, NOW);
    expect(read).toEqual({ ok: false, reason: "payload", destination: undefined });
    expect(read).toMatchObject({ ok: false });
    expect((read as { destination?: string }).destination).toBeUndefined();
  });

  it("firmado pero con ids que no son UUID: payload invalido (con el destino, que es autentico)", () => {
    const bad = forge({ v: 1, w: "no-uuid", c: C, u: DEST, f: F, p: null, s: null, e: Math.floor(NOW / 1000) + 1000 });
    expect(verifyTrackedLink(bad, SECRET, NOW)).toEqual({ ok: false, reason: "payload", destination: DEST });
    const badPiece = forge({ v: 1, w: W, c: C, u: DEST, f: F, p: "x", s: null, e: Math.floor(NOW / 1000) + 1000 });
    expect(verifyTrackedLink(badPiece, SECRET, NOW)).toMatchObject({ ok: false, reason: "payload" });
  });

  it("firmado pero sin vencimiento numerico: payload invalido", () => {
    expect(verifyTrackedLink(forge({ v: 1, w: W, c: C, u: DEST, f: F, p: null, s: null }), SECRET, NOW)).toMatchObject({ ok: false, reason: "payload" });
  });
});

describe("signTrackedLink (pedidos invalidos lanzan)", () => {
  it("sin secreto, con ids malos o destino que no es http(s)", () => {
    expect(() => signTrackedLink({ w: W, c: C, u: DEST, f: F }, "", NOW)).toThrow();
    expect(() => signTrackedLink({ w: "x", c: C, u: DEST, f: F }, SECRET, NOW)).toThrow();
    expect(() => signTrackedLink({ w: W, c: C, u: DEST, f: F, p: "x" }, SECRET, NOW)).toThrow();
    expect(() => signTrackedLink({ w: W, c: C, u: "javascript:alert(1)", f: F }, SECRET, NOW)).toThrow();
    expect(() => signTrackedLink({ w: W, c: C, u: "mailto:a@b.com", f: F }, SECRET, NOW)).toThrow();
    expect(() => signTrackedLink({ w: W, c: C, u: "https://a.com/" + "x".repeat(MAX_DESTINATION_LENGTH), f: F }, SECRET, NOW)).toThrow();
  });

  it("un destino de 2000 caracteres justos entra en el token", () => {
    const url = "https://a.com/" + "x".repeat(MAX_DESTINATION_LENGTH - "https://a.com/".length);
    expect(url).toHaveLength(MAX_DESTINATION_LENGTH);
    const read = verifyTrackedLink(signTrackedLink({ w: W, c: C, u: url, f: F }, SECRET, NOW), SECRET, NOW);
    expect(read.ok && read.payload.u).toBe(url);
  });

  it("los ids viajan dentro del token, no en claro", () => {
    const token = make();
    expect(token).not.toContain(C);
    expect(token).not.toContain(W);
  });
});

describe("peekTrackedLinkWorkspace", () => {
  it("lee el workspace sin verificar (para elegir el secreto)", () => {
    expect(peekTrackedLinkWorkspace(make())).toBe(W);
    // Incluso con firma mala: solo sirve para ir a buscar el secreto, la verificacion es aparte.
    expect(peekTrackedLinkWorkspace(`${make().split(".")[0]}.xxxx`)).toBe(W);
  });

  it("basura o un workspace que no es UUID: null", () => {
    for (const bad of ["", "abc", "a.b", null, undefined, 3, forge({ w: "no-uuid" }), "x".repeat(5000)]) {
      expect(peekTrackedLinkWorkspace(bad), String(bad)).toBeNull();
    }
  });
});

describe("safeRedirectTarget", () => {
  const FALLBACK = "https://app.example.com";

  it("deja pasar http y https", () => {
    expect(safeRedirectTarget("https://example.com/programa?x=1#y", FALLBACK)).toBe("https://example.com/programa?x=1#y");
    expect(safeRedirectTarget("http://example.com/", FALLBACK)).toBe("http://example.com/");
  });

  it("cualquier otra cosa va al fallback", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hola", "file:///etc/passwd", "mailto:a@b.com", "//evil.com", "/ruta", "", "   ", null, undefined, 5, "no es url", "https://", "https://example.com/\nSet-Cookie: x=1", "https://user:pass@evil.com/"]) {
      expect(safeRedirectTarget(bad, FALLBACK), String(bad)).toBe(FALLBACK);
    }
  });
});
