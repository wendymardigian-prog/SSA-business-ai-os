/**
 * «Entrega de marketing» y los resultados de un broadcast, dibujados de verdad (la guardia de entrega, 00287): el tope
 * de hoy, el calentamiento, el freno con «Reanudar», el aviso rojo del webhook y las cifras del email. Y que la tarjeta
 * Resend monta la seccion entre los remitentes y el webhook.
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
  saveMarketingDeliveryAction: vi.fn(),
  resumeMarketingAction: vi.fn(),
}));
vi.mock("@/lib/actions/broadcasts", () => ({
  cancelBroadcastAction: vi.fn(),
  pauseBroadcastAction: vi.fn(),
  resumeBroadcastAction: vi.fn(),
  resumeLaneAction: vi.fn(),
}));

import { MarketingDeliverySection } from "./marketing-delivery-section";
import { ResendCard } from "./resend-card";
import { BroadcastProgress } from "@/components/broadcasts/broadcast-progress";
import { readResendConnection } from "@/lib/email/resend-config";
import type { MarketingCapacity, MarketingDeliveryData } from "@/lib/email/marketing-delivery-view";

const capacity = (over: Partial<MarketingCapacity> = {}): MarketingCapacity => ({
  status: "ok",
  cap: 200,
  remaining: 150,
  used_today: 50,
  manual_cap: 1000,
  quota: null,
  all_today: 0,
  warmup_enabled: true,
  warmup_level: 1,
  warmup_level_date: "2026-11-06",
  next_day_start: "2026-11-07T06:00:00Z",
  time_zone: "America/Costa_Rica",
  paused_at: null,
  paused_reason: null,
  ...over,
});
const data = (over: Partial<MarketingDeliveryData> = {}): MarketingDeliveryData => ({
  capacity: capacity(),
  stats: { sent: 120, bounced: 1, complained: 0 },
  warmupSaved: true,
  webhookProblem: null,
  brakeLimits: { bouncePct: 2, complaintPct: 0.05 },
  ...over,
});
const section = (d: MarketingDeliveryData, readOnly = false) => renderToStaticMarkup(createElement(MarketingDeliverySection, { data: d, readOnly }));

describe("MarketingDeliverySection", () => {
  it("muestra los límites del freno guardados, y sin permiso no se pueden cambiar", () => {
    const html = section(data({ brakeLimits: { bouncePct: 3, complaintPct: 0.3 } }));
    expect(html).toContain("Freno automático");
    expect(html).toContain('id="marketing-brake-bounce"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="0,3"');
    const readOnly = section(data(), true);
    expect(readOnly).toContain('value="2"');
    expect(readOnly).toContain('value="0,05"');
    expect(readOnly).not.toContain("Guardar");
  });

  it("muestra el tope de hoy, el escalon, las cuentas y el maximo guardado", () => {
    const html = section(data());
    expect(html).toContain("Entrega de marketing");
    expect(html).toContain("Hoy salieron 50 de 200 emails de marketing.");
    expect(html).toContain("escalón 2 de 4 (200 por día)");
    expect(html).toContain("120 enviados");
    expect(html).toContain('value="1000"');
    expect(html).toContain("Guardar");
    expect(html).not.toContain("Reanudar el marketing");
  });

  it("con el freno puesto: el motivo, que lo transaccional sigue y «Reanudar»", () => {
    const html = section(data({ capacity: capacity({ status: "paused", paused_at: "2026-11-06T15:00:00Z", paused_reason: "Rebotaron 3 de 100." }) }));
    expect(html).toContain("El freno automático pausó el marketing");
    expect(html).toContain("Rebotaron 3 de 100.");
    expect(html).toContain("Los transaccionales siguen saliendo");
    expect(html).toContain("Reanudar el marketing");
  });

  it("el aviso rojo del webhook se ve, con role=alert", () => {
    const html = section(data({ webhookProblem: "Los rebotes y quejas no están llegando: el freno automático no puede funcionar." }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("el freno automático no puede funcionar");
  });

  it("solo lectura: ni guardar ni reanudar, y los campos deshabilitados", () => {
    const html = section(data({ capacity: capacity({ paused_at: "x", status: "paused" }) }), true);
    expect(html).not.toContain("Reanudar el marketing");
    expect(html).not.toContain(">Guardar<");
    expect(html).toContain('disabled=""');
  });

  it("la tarjeta Resend la monta entre los remitentes y el webhook, y sin datos no la muestra", () => {
    const card = (marketing: MarketingDeliveryData | null, connected = true) =>
      renderToStaticMarkup(
        createElement(ResendCard, {
          panel: { webhookUrl: "https://app.test/api/webhooks/resend-inbound?w=x", state: readResendConnection({ access: "full" }), secretSaved: true, lastEventAt: null, marketing },
          connected,
          fromEmail: "hola@negocio.test",
          readOnly: false,
          connection: createElement("div", null, "KEY"),
          senders: createElement("div", null, "REMITENTES-E8"),
        }),
      );
    const html = card(data());
    const [senders, delivery, webhook] = ["REMITENTES-E8", "Entrega de marketing", "Webhook (rebotes"].map((t) => html.indexOf(t));
    expect(senders).toBeGreaterThan(-1);
    expect(delivery).toBeGreaterThan(senders);
    expect(webhook).toBeGreaterThan(delivery);
    expect(card(null)).not.toContain("Entrega de marketing");
    expect(card(data(), false)).not.toContain("Entrega de marketing");
  });
});

describe("BroadcastProgress: los resultados del email (A9)", () => {
  const props = {
    broadcast: { id: "b-1", name: "Webinar", status: "sending" as const, scheduledFor: null, startedAt: null, completedAt: null, previewText: "" },
    channel: { id: "ch", label: "Email" },
    policy: null,
    lane: null,
    counts: { pending: 594, sending: 0, sent: 200, failed: 0, skipped: 3, cancelled: 0 },
    recipients: [
      { id: "r-1", contactId: "c-1", name: "Ana", target: "ana@x.test", status: "sent" as const, reason: null, sentAt: null, conversationId: null, emailBadges: ["Entregado", "Abrió (2)"] },
    ],
    filter: "" as const,
    page: 1,
    pageCount: 1,
    timeZone: "America/Costa_Rica",
    businessTimeZone: "America/Costa_Rica",
  };

  it("cifras, «aproximado», pendientes por el tope, filtros y marcas del destinatario", () => {
    const html = renderToStaticMarkup(
      createElement(BroadcastProgress, {
        ...props,
        emailResults: { sent: 200, delivered: 196, opened: 80, clicked: 12, bounced: 4, complained: 0, unsubscribed: 3 },
        deferredCount: 594,
        emailFilter: "abrio",
      }),
    );
    expect(html).toContain("Resultados del email");
    expect(html).toContain("Entregados");
    expect(html).toContain("Bajas de este email");
    expect(html).toContain("aproximadas");
    expect(html).toContain("esperan el máximo de emails de marketing del día");
    expect(html).toContain("Entregado · Abrió (2)");
    expect(html).toContain("?email=clic");
    expect(html).toContain('href="/dashboard/contacts/c-1"');
  });

  it("en WhatsApp (sin resultados de email): nada de eso", () => {
    const html = renderToStaticMarkup(createElement(BroadcastProgress, { ...props, recipients: [] }));
    expect(html).not.toContain("Resultados del email");
    expect(html).not.toContain("esperan el máximo");
  });
});
