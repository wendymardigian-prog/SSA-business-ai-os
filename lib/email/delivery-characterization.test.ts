/**
 * Caracterizacion ANTES de la guardia de entrega (automatizaciones de email, Fase 1a).
 *
 * Fija, byte a byte, lo que sale hoy:
 *  1. el HTML que arma el nodo «Enviar email» (texto plano y con formato);
 *  2. los emails del sistema (`templates.ts`): invitacion, aviso al equipo, link de baja y el marco;
 *  3. el pedido que recibe Resend de `sendTransactionalEmail`, en marketing y en transaccional.
 *
 * Cambios aprobados que pueden tocar estas fotos (y se anotan en el test que cambie):
 *  - el link y el header de baja de un email de MARKETING suman `?e=<id del registro>` (bajas atribuidas a un email).
 * Nada mas: el cuerpo, el remitente y los emails del sistema no cambian.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendTransactionalEmail, recordSkippedEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (_p: Record<string, unknown>) => ({ ok: true as const, id: "msg-1" }) as Record<string, unknown>),
  recordSkippedEmail: vi.fn(async () => undefined),
}));

describe("caracterizacion: el HTML del nodo «Enviar email»", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/lib/email/send", () => ({ sendTransactionalEmail, recordSkippedEmail }));
    vi.doMock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => true) }));
  });
  afterEach(() => {
    vi.doUnmock("@/lib/email/send");
    vi.doUnmock("@/lib/notifications/create");
  });

  function args(body: string, subject = "Hola {{contact.first_name}}") {
    const supabase = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          maybeSingle: async () => ({
            data:
              table === "contacts"
                ? { email: "ana@x.com", display_name: "Ana Paz", phone: null, do_not_contact: false }
                : table === "workspaces"
                  ? { name: "Mi Negocio" }
                  : table === "flows"
                    ? { form_id: null, event_type_id: null, template_key: null }
                    : null,
            error: null,
          }),
          then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
        };
        return chain;
      },
    };
    return {
      supabase,
      data: { to: "contact", subject, body },
      context: { workspaceId: "ws-1", contactId: "c-1", flowId: "f-1", variables: { contact: { first_name: "Ana" } } },
      node: { id: "n-1" },
    } as never;
  }

  async function sent(body: string) {
    const { sendEmailNode } = await import("@/lib/flow-engine/nodes/send-email");
    await sendEmailNode.execute(args(body));
    const call = sendTransactionalEmail.mock.calls.at(-1) as unknown as [Record<string, unknown>];
    const { deps: _deps, ...rest } = call[0];
    return rest;
  }

  it("texto plano", async () => {
    expect(await sent("Hola {{contact.first_name}}\n\nNos vemos el lunes.\nGracias.")).toMatchSnapshot();
  });

  it("con formato (editor)", async () => {
    expect(await sent('<p>Hola <strong>{{contact.first_name}}</strong></p><ul><li>Uno</li></ul><p><a href="https://x.com">link</a></p>')).toMatchSnapshot();
  });
});

describe("caracterizacion: los emails del sistema (templates.ts)", () => {
  it("invitacion, aviso al equipo, link de baja y el marco", async () => {
    const t = await import("./templates");
    const brand = { name: "Mi Negocio", logoUrl: null, colorHex: "#7c3aed", initial: "M" };
    expect(
      t.teamInviteEmail({ brand, inviterName: "Ana Paz", workspaceName: "Mi Negocio", roleLabel: "Admin", inviteUrl: "https://app.test/invite/abc" } as never),
    ).toMatchSnapshot("invitacion");
    expect(
      t.teamNotificationEmail({ brand, title: "Te asignaron un chat", body: "Ana te escribió", url: "https://app.test/x", settingsUrl: "https://app.test/cuenta", businessName: "Mi Negocio" }),
    ).toMatchSnapshot("aviso");
    expect(t.unsubscribeLinkEmail({ brand, unsubscribeUrl: "https://app.test/baja/tok" })).toMatchSnapshot("link de baja");
    expect(t.brandedEmailHtml({ brand, body: "<p>Hola</p>", preheader: "Algo", footerNote: "Nota" })).toMatchSnapshot("marco");
  });
});

describe("caracterizacion: lo que recibe Resend de sendTransactionalEmail", () => {
  const WS = "11111111-1111-1111-1111-111111111111";

  async function payload(category: "marketing" | "transactional") {
    vi.resetModules();
    const { fakeDb } = await import("@/lib/testing/fake-db");
    const { sendTransactionalEmail: send } = await import("./send");
    const db = fakeDb(
      {
        "integration_configs:select": {
          data: { config: { from_email: "hola@negocio.test", from_name: "Negocio", marketing_from_email: "novedades@negocio.test" }, is_active: true, vault_secret_name: null },
        },
        "workspaces:select": { data: { brand_name: "Negocio", brand_logo_path: null, brand_color: null, email_footer_address: "Calle 1", scheduling_public_base_url: null } },
        "email_log:insert": { data: null },
      },
      {
        read_secret: { data: "re_key_de_prueba" },
        email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "tok-1", matched: true } },
        reserve_email_send: { data: { status: "ok", log_id: "33333333-3333-3333-3333-333333333333" } },
      },
    );
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const res = await send({
      workspaceId: WS,
      to: "ana@x.com",
      subject: "Hola",
      html: "<p>Hola</p>",
      kind: "flow",
      contactId: "22222222-2222-2222-2222-222222222222",
      category,
      deps: { supabase: db.client, fetchImpl },
    });
    expect(res.ok).toBe(true);
    const init = fetchImpl.mock.calls[0][1] as { body: string };
    return JSON.parse(init.body);
  }

  it("transaccional: sin pie ni cabeceras de baja, del remitente de importantes", async () => {
    expect(await payload("transactional")).toMatchSnapshot();
  });

  it("marketing: con pie y cabeceras de baja, del remitente de marketing", async () => {
    expect(await payload("marketing")).toMatchSnapshot();
  });
});
