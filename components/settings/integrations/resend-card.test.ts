/**
 * La tarjeta Resend (conexion de Resend, R1, R5, R6), dibujada en su estado inicial: el orden de las secciones, la
 * URL del webhook con "Copiar" y los eventos, los textos pedidos y el plan B con una key de solo envio.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/resend-senders", () => ({ loadResendDomains: vi.fn(), saveResendSenders: vi.fn() }));
vi.mock("@/lib/actions/resend-connection", () => ({
  checkResendConnectionAction: vi.fn(),
  clearResendWebhookSecretAction: vi.fn(),
  connectResendWebhookAction: vi.fn(),
  saveResendReceivingAction: vi.fn(),
  saveResendWebhookSecretAction: vi.fn(),
}));

import { ResendCard } from "./resend-card";
import { readResendConnection, type ResendPanelData } from "@/lib/email/resend-config";

const URL = "https://app.negocio.test/api/webhooks/resend-inbound?w=11111111-1111-1111-1111-111111111111";

function render(config: Record<string, unknown>, extra: Partial<ResendPanelData> = {}, props: { connected?: boolean; readOnly?: boolean } = {}) {
  const panel: ResendPanelData = { webhookUrl: URL, state: readResendConnection(config), secretSaved: false, lastEventAt: null, ...extra };
  return renderToStaticMarkup(
    createElement(ResendCard, {
      panel,
      connected: props.connected ?? true,
      fromEmail: "hola@negocio.test",
      readOnly: props.readOnly ?? false,
      connection: createElement("div", null, "FORMULARIO-DE-LA-KEY"),
      senders: createElement("div", null, "REMITENTES-E8"),
    }),
  );
}

describe("ResendCard", () => {
  it("las secciones van en orden: Estado, Conexion, Remitentes, Webhook, Recepcion", () => {
    const html = render({ access: "full" });
    const order = ["Estado", "Conexión", "REMITENTES-E8", "Webhook (rebotes, quejas y emails entrantes)", "Recepción de emails (opcional)"].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("la URL del webhook con boton Copiar y los tres eventos", () => {
    const html = render({ access: "full" });
    expect(html).toContain(URL);
    expect(html).toContain("Copiar");
    for (const e of ["email.received", "email.bounced", "email.complained"]) expect(html).toContain(e);
    expect(html).toContain("Conectar webhook automáticamente");
  });

  it("los textos de R6", () => {
    const html = render({ access: "full" });
    expect(html).toContain("Con él SSA comprueba que el aviso viene de Resend. Se obtiene solo al conectar el webhook.");
    expect(html).toContain("Los emails que te escriban a cualquier dirección de este dominio entran a la bandeja como conversaciones.");
  });

  it("con la recepcion prendida, el link a la documentacion de Receiving", () => {
    const html = render({ access: "full", receiving_enabled: "true", receiving_domain: "negocio.test", receiving_local: "soporte" });
    expect(html).toContain("Cómo activar Receiving en Resend");
    expect(html).toContain("https://resend.com/docs/dashboard/receiving/custom-domains");
    expect(html).toContain('value="soporte"');
  });

  it("key de solo envio: el boton automatico deshabilitado y el paso a paso a mano con el campo del secreto", () => {
    const html = render({ access: "sending" });
    expect(html).toContain("Conectada · solo envío");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Conectar webhook automáticamente/);
    expect(html).toContain("resend.com/webhooks");
    expect(html).toContain('placeholder="whsec_…"');
  });

  it("webhook conectado: estado y 'Actualizar webhook'; el secreto solo dice que esta guardado", () => {
    const html = render(
      { access: "full", webhook_id: "wh_1", webhook_events: "email.received,email.bounced,email.complained", webhook_secret_saved_at: "2026-11-01T00:00:00Z" },
      { secretSaved: true, lastEventAt: new Date(Date.now() - 5 * 60_000).toISOString() },
    );
    expect(html).toContain("Webhook conectado · 3 eventos · último aviso recibido hace 5 minutos");
    expect(html).toContain("Actualizar webhook");
    expect(html).toContain("Guardado");
    expect(html).not.toContain("whsec_");
  });

  it("sin la URL publica: lo dice y no ofrece conectar", () => {
    const html = render({ access: "full" }, { webhookUrl: null });
    expect(html).toContain("no tiene un dominio público");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Conectar webhook automáticamente/);
  });
});
