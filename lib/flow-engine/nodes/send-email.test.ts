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
