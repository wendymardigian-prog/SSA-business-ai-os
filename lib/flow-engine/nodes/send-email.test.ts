/**
 * El nodo "Enviar email": el email que manda una automatizacion tiene que
 * quedar atado al contacto (00135) para aparecer en su historial.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendTransactionalEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async () => ({ ok: true as const, id: "msg-1" })),
}));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => true) }));

import { sendEmailNode } from "./send-email";

function args(overrides: { to?: "contact" | "host" | "fixed"; fixedEmail?: string; doNotContact?: boolean; subject?: string; body?: string } = {}) {
  const supabase = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        maybeSingle: async () => ({
          data:
            table === "contacts"
              ? { email: "ana@x.com", display_name: "Ana", phone: null, do_not_contact: overrides.doNotContact ?? false }
              : table === "workspaces"
                ? { name: "Mi Negocio" }
                : null,
          error: null,
        }),
        // El conteo de la cuota: `select(..., { count, head })` termina en la cadena.
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      };
      return chain;
    },
  };
  return {
    supabase,
    data: { to: overrides.to ?? "contact", fixedEmail: overrides.fixedEmail, subject: overrides.subject ?? "Tu reunión", body: overrides.body ?? "Hola" },
    context: { workspaceId: "ws-1", contactId: "c-1", flowId: "f-1", variables: {} },
    node: { id: "n-1" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("send_email: el contacto del registro", () => {
  it("al contacto: el envio lleva su id", async () => {
    await sendEmailNode.execute(args());
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@x.com", kind: "flow", relatedEntityType: "flow", relatedEntityId: "f-1", contactId: "c-1" }),
    );
  });

  it("a una direccion fija: sigue siendo una accion sobre ESTE contacto, y se ve en su historial", async () => {
    await sendEmailNode.execute(args({ to: "fixed", fixedEmail: "equipo@negocio.com" }));
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "equipo@negocio.com", contactId: "c-1" }),
    );
  });

  it("un contacto 'no contactar' no recibe el email (y no queda registro de un envio que no hubo)", async () => {
    await sendEmailNode.execute(args({ doNotContact: true }));
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("send_email: texto de la banca insertado", () => {
  it("las variables del recurso ({{contact.*}}, {{workspace.*}}) se resuelven con los datos reales", async () => {
    await sendEmailNode.execute(
      args({ subject: "Hola {{contact.display_name}}", body: "Te escribe {{workspace.name}}. Reunión: {{booking.start_invitee}}" }),
    );
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Hola Ana", html: expect.stringContaining("Te escribe Mi Negocio.") }),
    );
  });
});

describe("send_email: cuerpo con formato (editor de texto enriquecido)", () => {
  function withVariables(body: string, variables: Record<string, unknown>) {
    const base = args({ body }) as unknown as { context: { variables: Record<string, unknown> } };
    base.context.variables = variables;
    return base as never;
  }
  const lastHtml = () => (sendTransactionalEmail.mock.calls.at(-1) as unknown as [{ html: string }])[0].html;

  it("un cuerpo HTML conserva el formato y suma estilos en linea", async () => {
    await sendEmailNode.execute(withVariables("<h2>Hola</h2><p>Esto es <strong>importante</strong> 😀</p>", {}));
    expect(lastHtml()).toContain("<strong>importante</strong>");
    expect(lastHtml()).toContain('<h2 style="');
    expect(lastHtml()).toContain("😀");
  });

  it("los valores de las variables se escapan: un nombre con HTML no se vuelve una etiqueta", async () => {
    await sendEmailNode.execute(withVariables("<p>Hola {{lead.name}}</p>", { lead: { name: '<a href="https://malo.com">click</a><script>x()</script>' } }));
    expect(lastHtml()).not.toContain("<script");
    expect(lastHtml()).not.toContain("malo.com\"");
    expect(lastHtml()).toContain("&lt;a href=");
  });

  it("un cuerpo en texto plano NUNCA pasa por HTML aunque un valor traiga etiquetas", async () => {
    await sendEmailNode.execute(withVariables("Hola {{lead.name}}", { lead: { name: "<b>Ana</b>" } }));
    expect(lastHtml()).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(lastHtml()).not.toContain("<b>");
  });

  it("un link javascript: del cuerpo se descarta", async () => {
    await sendEmailNode.execute(withVariables('<p><a href="javascript:alert(1)">ver</a></p>', {}));
    expect(lastHtml()).not.toContain("javascript:");
  });

  it("las variables de la banca ({{contact.display_name}}) se escapan en un cuerpo HTML", async () => {
    const a = args({ body: "<p>{{contact.display_name}}</p>" }) as unknown as { supabase: { from: (t: string) => unknown } };
    const original = a.supabase.from.bind(a.supabase);
    a.supabase.from = (t: string) => {
      const chain = original(t) as { maybeSingle: () => Promise<unknown> };
      if (t === "contacts") chain.maybeSingle = async () => ({ data: { email: "ana@x.com", display_name: "<i>Ana</i>", phone: null, do_not_contact: false }, error: null });
      return chain;
    };
    await sendEmailNode.execute(a as never);
    expect(lastHtml()).toContain("&lt;i&gt;Ana&lt;/i&gt;");
  });
});

describe("send_email: caracterizacion de 'no contactar' (antes de la suscripcion a emails)", () => {
  it("un flujo de agenda manda igual a un contacto 'no contactar' (es una reunion que pidio)", async () => {
    const a = args({ doNotContact: true }) as unknown as { context: { variables: Record<string, unknown> } };
    a.context.variables = { trigger_scope: "booking" };
    await sendEmailNode.execute(a as never);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@x.com", contactId: "c-1" }));
  });

  it("'no contactar' tambien frena el envio a una direccion fija del flujo de ese contacto", async () => {
    await sendEmailNode.execute(args({ to: "fixed", fixedEmail: "equipo@negocio.com", doNotContact: true }));
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe("send_email: adjuntos de Recursos (auditoria de automatizaciones)", () => {
  it("los adjuntos viajan en el envio", async () => {
    const loader = await import("@/lib/email/flow-attachments");
    const spy = vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [{ filename: "a.pdf", content: "QUJD" }], missing: [] });
    const a = args() as unknown as { data: Record<string, unknown> };
    a.data.attachments = [{ assetId: "a1", name: "a.pdf" }];
    await sendEmailNode.execute(a as never);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: "a.pdf", content: "QUJD" }] }));
    spy.mockRestore();
  });

  it("sin adjuntos no se pasa la clave (el email sale como siempre)", async () => {
    await sendEmailNode.execute(args());
    const call = (sendTransactionalEmail.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect("attachments" in call).toBe(false);
  });
});
