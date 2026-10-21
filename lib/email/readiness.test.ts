import { describe, expect, it } from "vitest";
import { describeEmailReadiness } from "./readiness";

const connected = { is_active: true, from_email: "hola@negocio.com" };

describe("describeEmailReadiness", () => {
  it("conectado, con remitente y sin rechazos: listo", () => {
    expect(describeEmailReadiness({ integration: connected, lastLog: null })).toEqual({ ok: true });
    expect(describeEmailReadiness({ integration: connected, lastLog: { status: "sent", last_error: null } })).toEqual({ ok: true });
  });

  it("sin conectar o apagado; sin remitente", () => {
    expect(describeEmailReadiness({ integration: null, lastLog: null })).toMatchObject({ ok: false, reason: "not_connected" });
    expect(describeEmailReadiness({ integration: { ...connected, is_active: false }, lastLog: null })).toMatchObject({ ok: false, reason: "not_connected" });
    expect(describeEmailReadiness({ integration: { is_active: true, from_email: " " }, lastLog: null })).toMatchObject({ ok: false, reason: "no_sender" });
  });

  it("el dominio sin verificar (el caso real): lo nombra y dice cómo arreglarlo", () => {
    const result = describeEmailReadiness({
      integration: connected,
      lastLog: { status: "failed", last_error: "Resend respondio 403: The negocio.com domain is not verified. Please, add and verify your domain on https://resend.com/domains" },
    });
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect(!result.ok && result.message).toContain("negocio.com");
  });

  it("una clave o remitente rechazado (401/403) avisa; un 429 o un 5xx no (pasan solos)", () => {
    expect(describeEmailReadiness({ integration: connected, lastLog: { status: "failed", last_error: "Resend respondio 401: API key is invalid" } })).toMatchObject({ ok: false });
    expect(describeEmailReadiness({ integration: connected, lastLog: { status: "failed", last_error: "Resend respondio 429: rate limit" } })).toEqual({ ok: true });
    expect(describeEmailReadiness({ integration: connected, lastLog: { status: "failed", last_error: "Resend respondio 503: down" } })).toEqual({ ok: true });
  });
});
