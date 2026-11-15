// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { signPortalRequest, verifyPortalRequest } from "./portal-signature";

const secret = "x".repeat(40);
const now = 1_800_000_000_000;
const body = JSON.stringify({ host: "portal.example.com", email: "a@example.com" });

describe("la firma del portal", () => {
  const sig = signPortalRequest(secret, now, body);
  it("acepta la firma correcta", () => expect(verifyPortalRequest({ secret, timestamp: String(now), signature: sig, body, nowMs: now + 1000 })).toBe(true));
  it("rechaza otro cuerpo, otro secreto o sin secreto", () => {
    expect(verifyPortalRequest({ secret, timestamp: String(now), signature: sig, body: body + " ", nowMs: now })).toBe(false);
    expect(verifyPortalRequest({ secret: "y".repeat(40), timestamp: String(now), signature: sig, body, nowMs: now })).toBe(false);
    expect(verifyPortalRequest({ secret: undefined, timestamp: String(now), signature: sig, body, nowMs: now })).toBe(false);
    expect(verifyPortalRequest({ secret: "corto", timestamp: String(now), signature: signPortalRequest("corto", now, body), body, nowMs: now })).toBe(false);
  });
  it("rechaza una firma vieja o del futuro (más de 5 minutos)", () => {
    expect(verifyPortalRequest({ secret, timestamp: String(now), signature: sig, body, nowMs: now + 6 * 60_000 })).toBe(false);
    expect(verifyPortalRequest({ secret, timestamp: String(now), signature: sig, body, nowMs: now - 6 * 60_000 })).toBe(false);
  });
  it("rechaza headers mal formados", () => {
    expect(verifyPortalRequest({ secret, timestamp: null, signature: sig, body, nowMs: now })).toBe(false);
    expect(verifyPortalRequest({ secret, timestamp: String(now), signature: "zz", body, nowMs: now })).toBe(false);
  });
});
