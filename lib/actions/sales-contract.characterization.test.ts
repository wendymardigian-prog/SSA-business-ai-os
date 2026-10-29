/**
 * Caracterizacion de `emailContractLink` (camino F del inventario de envios),
 * escrita ANTES de la suscripcion a emails: el link del contrato se manda al
 * email del contacto por el envio transaccional, sin mirar "no contactar".
 * La decision de Wendy (29/10/2026) es mantenerlo: solo un rebote lo frena.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const SALE = "33333333-3333-4333-8333-333333333333";
const FORM = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (_p: Record<string, unknown>) => ({ ok: true as const, id: "re_1" })),
  user: null as unknown,
  service: null as unknown,
}));

vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: h.sendTransactionalEmail }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://app.test" }));
vi.mock("@/lib/forms/signed-link", () => ({ signFormLink: vi.fn(async () => "https://app.test/f/contrato?t=abc") }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: vi.fn(async () => ({ supabase: (h.user as { client: unknown }).client, workspace: { id: "ws-1" }, user: { id: "u-1" } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (h.service as { client: unknown }).client) }));

import { emailContractLink } from "./sales-contract";

function setup(contact: Record<string, unknown>) {
  h.user = fakeDb({
    "sales:select": { data: { id: SALE, contact_id: CONTACT, status: "active", product_snapshot: {}, final_amount: 100, service_starts_at: null } },
    "contacts:select": { data: { id: CONTACT, display_name: "Ana", email: "ana@x.test", phone: null, ...contact } },
    "conversations:select": { data: [] },
  });
  h.service = fakeDb({
    "forms:select": { data: { id: FORM, name: "Acuerdo", slug: "acuerdo", status: "published", type: "contract", current_version_id: "v1" } },
    "form_versions:select": { data: { id: "v1", version_number: 1, definition: { fields: [] }, contract_text: "Texto" } },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("emailContractLink (hoy)", () => {
  it("manda el link al email del contacto por el envio transaccional", async () => {
    setup({});
    const res = await emailContractLink({ saleId: SALE, formId: FORM });
    expect(res.ok).toBe(true);
    expect(h.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@x.test", kind: "sale_contract_link", contactId: CONTACT, relatedEntityId: SALE }),
    );
  });

  it("no mira 'no contactar': la persona pidio el contrato", async () => {
    setup({ do_not_contact: true });
    const res = await emailContractLink({ saleId: SALE, formId: FORM });
    expect(res.ok).toBe(true);
    expect(h.sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it("sin email, avisa y no manda", async () => {
    setup({ email: null });
    const res = await emailContractLink({ saleId: SALE, formId: FORM });
    expect(res).toEqual({ ok: false, error: "Este contacto no tiene email" });
    expect(h.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("emailContractLink: suscripcion a emails (cambio aprobado)", () => {
  it("va como transaccional: le llega aunque se haya dado de baja de marketing", async () => {
    setup({});
    await emailContractLink({ saleId: SALE, formId: FORM });
    expect(h.sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ category: "transactional" }));
    expect(h.sendTransactionalEmail.mock.calls[0][0]).not.toHaveProperty("honorDoNotContact");
  });

  it("si la puerta lo saltea (el email rebota), avisa con el motivo y no deja el envio en el historial de la venta", async () => {
    setup({});
    h.sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "skipped", skip: "bounced", error: "No se mandó: el email de esta persona rebota." } as never);
    const res = await emailContractLink({ saleId: SALE, formId: FORM });
    expect(res).toEqual({ ok: false, error: "No se mandó: el email de esta persona rebota." });
  });
});
