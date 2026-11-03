import { describe, it, expect } from "vitest";
import { resendChecklist, timeAgo, type ChecklistInput } from "./resend-status";
import { readResendConnection } from "./resend-config";

const NOW = new Date("2026-11-02T12:00:00Z");
const VERIFIED = [{ name: "negocio.test", status: "verified", receiving: "enabled" as const }];

function input(config: Record<string, unknown>, extra: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    connected: true,
    state: readResendConnection(config),
    fromEmail: "hola@negocio.test",
    domains: VERIFIED,
    secretSaved: true,
    lastEventAt: null,
    now: NOW,
    ...extra,
  };
}

const byId = (items: ReturnType<typeof resendChecklist>) => Object.fromEntries(items.map((i) => [i.id, i]));

const CONNECTED = { access: "full", webhook_id: "wh_1", webhook_events: "email.received,email.bounced,email.complained" };

describe("resendChecklist", () => {
  it("todo listo: key completa, remitente verificado, webhook con 3 eventos, recepcion activa y ultimo aviso", () => {
    const items = byId(
      resendChecklist(input({ ...CONNECTED, receiving_enabled: "true", receiving_domain: "negocio.test", receiving_local: "hola" }, { lastEventAt: "2026-11-02T11:55:00Z" })),
    );
    expect(items.key).toMatchObject({ status: "ok", title: "API key conectada · acceso completo" });
    expect(items.sender).toMatchObject({ status: "ok" });
    expect(items.webhook).toMatchObject({ status: "ok", title: "Webhook conectado · 3 eventos" });
    expect(items.receiving).toMatchObject({ status: "ok", title: expect.stringContaining("hola@negocio.test") });
    expect(items.last_event).toMatchObject({ status: "ok", title: "Último aviso recibido hace 5 minutos" });
  });

  it("sin key: todo dice que hacer", () => {
    const items = byId(resendChecklist(input({}, { connected: false, fromEmail: null, domains: null, secretSaved: false })));
    expect(items.key.status).toBe("fail");
    expect(items.sender.status).toBe("fail");
    expect(items.webhook).toMatchObject({ status: "fail", detail: expect.stringContaining("Falta conectar") });
    expect(items.receiving.status).toBe("na");
    expect(items.last_event.status).toBe("na");
  });

  it("solo envio: la key esta bien, el webhook y los dominios a mano", () => {
    const items = byId(resendChecklist(input({ access: "sending" }, { domains: null, secretSaved: false })));
    expect(items.key).toMatchObject({ status: "ok", title: "API key conectada · solo envío" });
    expect(items.sender.status).toBe("na");
    expect(items.webhook.status).toBe("fail");
  });

  it("webhook adoptado sin secreto: pide pegarlo", () => {
    expect(byId(resendChecklist(input({ ...CONNECTED, webhook_needs_secret: "true" }, { secretSaved: false }))).webhook).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("Signing secret"),
    });
  });

  it("le faltan eventos (guardado o segun Probar)", () => {
    expect(byId(resendChecklist(input({ ...CONNECTED, webhook_events: "email.received" }))).webhook.detail).toContain("email.bounced, email.complained");
    const live = { key: { ok: true as const, access: "full" as const }, webhook: { checked: true as const, found: true as const, missing: ["email.complained"], disabled: false } };
    expect(byId(resendChecklist(input(CONNECTED, { live }))).webhook.detail).toContain("email.complained");
  });

  it("Probar dice que en Resend no hay webhook de SSA", () => {
    const live = { key: { ok: true as const, access: "full" as const }, webhook: { checked: true as const, found: false as const } };
    expect(byId(resendChecklist(input(CONNECTED, { live }))).webhook.status).toBe("fail");
  });

  it("Probar con la key rechazada", () => {
    const live = { key: { ok: false as const, error: "Resend rechazó la API key" }, webhook: { checked: false as const, reason: "x" } };
    expect(byId(resendChecklist(input(CONNECTED, { live }))).key).toMatchObject({ status: "fail", detail: "Resend rechazó la API key" });
  });

  it("remitente con dominio sin verificar", () => {
    expect(byId(resendChecklist(input(CONNECTED, { domains: [{ name: "negocio.test", status: "pending" }] }))).sender.status).toBe("fail");
  });

  it("recepcion prendida con Receiving apagado en Resend", () => {
    const items = byId(
      resendChecklist(input({ ...CONNECTED, receiving_enabled: "true", receiving_domain: "negocio.test" }, { domains: [{ name: "negocio.test", status: "verified", receiving: "disabled" }] })),
    );
    expect(items.receiving).toMatchObject({ status: "fail", detail: expect.stringContaining("Receiving") });
  });
});

describe("timeAgo", () => {
  it("minutos, horas y dias", () => {
    expect(timeAgo("2026-11-02T11:59:50Z", NOW)).toBe("hace menos de un minuto");
    expect(timeAgo("2026-11-02T11:59:00Z", NOW)).toBe("hace 1 minuto");
    expect(timeAgo("2026-11-02T09:00:00Z", NOW)).toBe("hace 3 horas");
    expect(timeAgo("2026-10-31T12:00:00Z", NOW)).toBe("hace 2 días");
  });
});
