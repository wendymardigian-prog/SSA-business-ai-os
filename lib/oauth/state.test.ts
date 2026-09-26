import { describe, it, expect } from "vitest";
import {
  newNonce,
  safeRedirect,
  signState,
  STATE_TTL_MS,
  verifyState,
  type StatePayload,
} from "./state";

const SECRET = "un-secreto-de-prueba-largo-1234567890";
const NOW = 1_800_000_000_000;

const payload = (over: Partial<StatePayload> = {}): StatePayload => ({
  nonce: "nonce-1",
  provider: "google",
  userId: "user-1",
  workspaceId: "ws-1",
  redirectTo: "/dashboard/settings/integrations",
  exp: NOW + STATE_TTL_MS,
  ...over,
});

describe("el state firmado (F9)", () => {
  it("ida y vuelta: lo que se firma es lo que vuelve", () => {
    const token = signState(SECRET, payload());
    const result = verifyState(SECRET, token, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual(payload());
  });

  it("un state fabricado por otro no pasa: la firma no cierra", () => {
    const token = signState("otro-secreto-distinto-123456", payload());

    expect(verifyState(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("cambiar el contenido invalida la firma", () => {
    // El caso que importa: alguien edita el workspace para conectar su cuenta
    // dentro del negocio de otro.
    const token = signState(SECRET, payload());
    const [body, signature] = token.split(".");
    const alterado = Buffer.from(
      JSON.stringify({ ...payload(), workspaceId: "ws-del-atacante" }),
    ).toString("base64url");

    expect(verifyState(SECRET, `${alterado}.${signature}`, { now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(body).not.toBe(alterado);
  });

  it("vencido se rechaza", () => {
    const token = signState(SECRET, payload({ exp: NOW - 1 }));

    expect(verifyState(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "expired" });
  });

  it("justo en el limite ya no vale", () => {
    const token = signState(SECRET, payload({ exp: NOW }));

    expect(verifyState(SECRET, token, { now: NOW }).ok).toBe(false);
  });

  it("de otro usuario se rechaza", () => {
    const token = signState(SECRET, payload());

    expect(verifyState(SECRET, token, { now: NOW, expectedUserId: "user-2" })).toEqual({
      ok: false,
      reason: "user_mismatch",
    });
  });

  it("de otro workspace o de otro proveedor se rechaza", () => {
    const token = signState(SECRET, payload());

    expect(verifyState(SECRET, token, { now: NOW, expectedWorkspaceId: "ws-2" }).ok).toBe(false);
    expect(verifyState(SECRET, token, { now: NOW, expectedProvider: "linkedin" })).toEqual({
      ok: false,
      reason: "provider_mismatch",
    });
  });

  it("sin la cookie del navegador no alcanza con que la firma cierre", () => {
    // Un token valido copiado de otro lado: la firma esta bien, pero la cookie
    // la puso el navegador que inicio la conexion.
    const token = signState(SECRET, payload());

    expect(verifyState(SECRET, token, { now: NOW, expectedNonce: null })).toEqual({
      ok: false,
      reason: "nonce_mismatch",
    });
    expect(verifyState(SECRET, token, { now: NOW, expectedNonce: "otro-nonce" })).toEqual({
      ok: false,
      reason: "nonce_mismatch",
    });
    expect(verifyState(SECRET, token, { now: NOW, expectedNonce: "nonce-1" }).ok).toBe(true);
  });

  it("el mismo state usado dos veces falla la segunda", () => {
    // Porque el retorno borra la cookie: la segunda vez no hay nonce con que
    // comparar.
    const token = signState(SECRET, payload());
    const cookie: string | null = "nonce-1";

    expect(verifyState(SECRET, token, { now: NOW, expectedNonce: cookie }).ok).toBe(true);
    expect(verifyState(SECRET, token, { now: NOW, expectedNonce: null }).ok).toBe(false);
  });

  it("basura se rechaza sin romperse", () => {
    for (const malo of ["", "sin-punto", ".", "a.", ".b", "no-es-base64.firma", null, undefined]) {
      expect(verifyState(SECRET, malo as string, { now: NOW }).ok).toBe(false);
    }
  });

  it("un cuerpo firmado que no es el esperado se rechaza por formato", () => {
    // Firmado por nosotros (la firma cierra), pero sin los campos que hacen
    // falta: igual no se usa.
    const body = Buffer.from(JSON.stringify({ hola: "mundo" })).toString("base64url");
    const token = signState(SECRET, { hola: "mundo" } as unknown as StatePayload);

    expect(verifyState(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "invalid_format" });
    expect(token.startsWith(body)).toBe(true);
  });

  it("cada nonce es distinto", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newNonce()));

    expect(nonces.size).toBe(50);
  });
});

describe("a donde se vuelve despues de conectar", () => {
  it("acepta las rutas internas de la lista", () => {
    expect(safeRedirect("/dashboard/settings/integrations")).toBe("/dashboard/settings/integrations");
    expect(safeRedirect("/dashboard/channels")).toBe("/dashboard/channels");
    expect(safeRedirect("/dashboard/social?red=youtube")).toBe("/dashboard/social?red=youtube");
  });

  it("una direccion de afuera no pasa: seria un redirector abierto", () => {
    for (const malo of [
      "https://sitio-del-atacante.test",
      "//sitio-del-atacante.test",
      "/\\sitio-del-atacante.test",
      "javascript:alert(1)",
      "/dashboard/../../etc",
    ]) {
      expect(safeRedirect(malo)).toBe("/dashboard/settings/integrations");
    }
  });

  it("una ruta interna que no esta en la lista cae al default", () => {
    expect(safeRedirect("/dashboard/contacts")).toBe("/dashboard/settings/integrations");
    expect(safeRedirect(null)).toBe("/dashboard/settings/integrations");
    expect(safeRedirect("")).toBe("/dashboard/settings/integrations");
  });
});
