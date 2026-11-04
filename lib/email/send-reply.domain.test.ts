/**
 * Recepcion por dominio (R4): la respuesta sale desde la MISMA direccion a la que escribio la persona (si es del
 * dominio del canal). Escribir primero, o un hilo de otro dominio, sale desde la principal.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { sendEmailReply } from "./send-reply";

const WS = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const channel = { platform: "email", is_active: true, email_address: "hola@negocio.test" };

function db(lastInbound: Record<string, unknown> | null, config: Record<string, unknown> | null = null) {
  return fakeDb(
    {
      "messages:select": { data: lastInbound },
      "integration_configs:select": { data: config ? { config } : null },
    },
    { read_secret: { data: "re_key" }, email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "tok", matched: true } }, reserve_email_send: { data: { status: "ok", log_id: null } } },
  );
}

async function sendWith(d: ReturnType<typeof db>, category: "transactional" | "marketing" = "transactional") {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
  const res = await sendEmailReply(d.client, {
    workspaceId: WS, conversationId: CONV, channel, toAddress: "ana@cliente.test", text: "Hola", contactOptedOut: false, category,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(res.ok).toBe(true);
  return JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
}

afterEach(() => vi.restoreAllMocks());

describe("desde que direccion se responde", () => {
  it("la persona escribio a soporte@: la respuesta sale de soporte@ (y sigue el hilo)", async () => {
    const body = await sendWith(db({ email_subject: "Ayuda", email_message_id: "<m@x>", email_references: null, email_from: "Ana <ana@cliente.test>", email_to: ["Soporte <soporte@negocio.test>"], email_cc: [] }));
    expect(body.from).toBe("soporte@negocio.test");
    expect(body.headers).toMatchObject({ "In-Reply-To": "<m@x>" });
  });

  it("si la persona puso nuestra direccion en copia, tambien", async () => {
    const body = await sendWith(db({ email_subject: "x", email_message_id: "<m@x>", email_references: null, email_from: "ana@cliente.test", email_to: ["otro@cliente.test"], email_cc: ["ventas@negocio.test"] }));
    expect(body.from).toBe("ventas@negocio.test");
  });

  it("nunca desde otro dominio: sale desde la principal", async () => {
    const body = await sendWith(db({ email_subject: "x", email_message_id: "<m@x>", email_references: null, email_from: "ana@cliente.test", email_to: ["alguien@otro-dominio.test"], email_cc: null }));
    expect(body.from).toBe("hola@negocio.test");
  });

  it("escribir primero (sin entrante): la direccion principal", async () => {
    const body = await sendWith(db(null));
    expect(body.from).toBe("hola@negocio.test");
  });

  it("marketing con remitente propio: 'Responder a' es la direccion a la que escribio la persona", async () => {
    const body = await sendWith(
      db({ email_subject: "x", email_message_id: "<m@x>", email_references: null, email_from: "ana@cliente.test", email_to: ["soporte@negocio.test"] }, { marketing_from_email: "news@news.negocio.test", from_name: "Negocio" }),
      "marketing",
    );
    expect(body.from).toBe("Negocio <news@news.negocio.test>");
    expect(body.reply_to).toBe("soporte@negocio.test");
  });
});
