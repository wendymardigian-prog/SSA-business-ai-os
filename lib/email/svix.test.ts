/**
 * La firma de los webhooks de Resend (F63).
 */

import { describe, it, expect } from "vitest";
import { expectedSignature, secretBytes, verifySvixSignature, TOLERANCE_MS } from "./svix";

const SECRET = `whsec_${Buffer.from("un-secreto-de-prueba").toString("base64")}`;
const NOW = new Date("2026-10-01T12:00:00Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const BODY = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });

function headers(over: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  const id = over.id ?? "msg_1";
  const timestamp = over.timestamp ?? TIMESTAMP;
  const signature =
    over.signature ?? `v1,${expectedSignature({ secret: SECRET, id, timestamp, body: BODY })}`;
  return { id, timestamp, signature };
}

describe("el secreto (F63)", () => {
  it("se le saca el prefijo y se decodifica de base64", () => {
    // Firmar con el texto en vez de los bytes da una firma que nunca valida.
    expect(secretBytes(SECRET).toString()).toBe("un-secreto-de-prueba");
  });

  it("uno sin prefijo tambien se acepta", () => {
    expect(secretBytes(Buffer.from("x").toString("base64")).toString()).toBe("x");
  });
});

describe("verificar (F63)", () => {
  it("una firma buena pasa", () => {
    expect(verifySvixSignature({ secret: SECRET, headers: headers(), body: BODY, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("se firma id.timestamp.body, no el body solo", () => {
    // Firmar solo el cuerpo dejaria reenviar un webhook viejo tal cual.
    const onlyBody = Buffer.from("x").toString("base64");

    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: headers({ signature: `v1,${onlyBody}` }),
        body: BODY,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("si cambia el cuerpo, la firma deja de valer", () => {
    expect(
      verifySvixSignature({ secret: SECRET, headers: headers(), body: `${BODY} `, now: NOW }),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("acepta varias firmas: durante una rotacion vienen las dos", () => {
    const good = expectedSignature({ secret: SECRET, id: "msg_1", timestamp: TIMESTAMP, body: BODY });

    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: headers({ signature: `v1,unafirmavieja v1,${good}` }),
        body: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("una firma de otra version se ignora", () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: headers({ signature: "v2,algo" }),
        body: BODY,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("pasados los 5 minutos se rechaza", () => {
    // Un webhook capturado hoy no sirve mañana.
    const later = new Date(NOW.getTime() + TOLERANCE_MS + 1000);

    expect(
      verifySvixSignature({ secret: SECRET, headers: headers(), body: BODY, now: later }),
    ).toMatchObject({ ok: false, reason: "too_old" });
  });

  it("un timestamp del futuro tambien", () => {
    const earlier = new Date(NOW.getTime() - TOLERANCE_MS - 1000);

    expect(
      verifySvixSignature({ secret: SECRET, headers: headers(), body: BODY, now: earlier }),
    ).toMatchObject({ ok: false, reason: "too_old" });
  });

  it("sin cabeceras no se valida nada", () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: { id: null, timestamp: null, signature: null },
        body: BODY,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "missing_headers" });
  });

  it("un timestamp que no es un numero se rechaza sin romper", () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: headers({ timestamp: "ayer" }),
        body: BODY,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "bad_timestamp" });
  });
});
