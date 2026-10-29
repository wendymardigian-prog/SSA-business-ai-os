/**
 * Caracterizacion de `sendEmailReply` (camino B y C del inventario de envios,
 * docs/PROGRESS-suscripcion-email.md), escrita ANTES de la suscripcion a emails.
 *
 * Fija lo que hoy hace una respuesta por email: sale desde la direccion del canal,
 * sigue el hilo con In-Reply-To/References, "no contactar" la frena sin llamar a
 * Resend, y no lleva cabeceras de baja. Lo que cambia con la suscripcion (un
 * email de marketing lleva el pie y las cabeceras de baja) tiene su propio test.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { sendEmailReply } from "./send-reply";

const WS = "11111111-1111-1111-1111-111111111111";
const CONV = "22222222-2222-2222-2222-222222222222";
const KEY = "re_key_de_prueba_que_no_sale";

function db(lastInbound: Record<string, unknown> | null = null) {
  return fakeDb(
    {
      "messages:select": { data: lastInbound },
      "integration_configs:select": { data: null },
    },
    { read_secret: { data: KEY } },
  );
}

const channel = { platform: "email", is_active: true, email_address: "hola@negocio.test" };

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
}

afterEach(() => vi.restoreAllMocks());

describe("sendEmailReply (hoy)", () => {
  it("sale desde la direccion del canal, al destinatario dado, y sigue el hilo", async () => {
    const fetchImpl = okFetch();
    const d = db({ email_subject: "Consulta", email_message_id: "<abc@x>", email_references: null, email_from: "Ana <ana@x.test>" });
    const res = await sendEmailReply(d.client, {
      workspaceId: WS,
      conversationId: CONV,
      channel,
      toAddress: "ana@x.test",
      text: "Hola Ana",
      contactOptedOut: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res).toMatchObject({ ok: true, messageId: "re_1", providerId: "re_1" });
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.from).toBe("hola@negocio.test");
    expect(body.to).toBe("ana@x.test");
    expect(body.subject).toBe("Re: Consulta");
    expect(body.headers).toEqual({ "In-Reply-To": "<abc@x>", References: "<abc@x>" });
    expect(body.html).toContain("Hola Ana");
  });

  it("sin destinatario dado, responde al remitente del ultimo entrante", async () => {
    const fetchImpl = okFetch();
    const d = db({ email_subject: "x", email_message_id: "<m@x>", email_references: null, email_from: "Ana <ANA@x.test>" });
    await sendEmailReply(d.client, {
      workspaceId: WS, conversationId: CONV, channel, toAddress: null, text: "hola", contactOptedOut: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).to).toBe("ana@x.test");
  });

  it("'no contactar' la frena antes de llamar a Resend", async () => {
    const fetchImpl = okFetch();
    const res = await sendEmailReply(db().client, {
      workspaceId: WS, conversationId: CONV, channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin hilo previo es un correo nuevo: sin In-Reply-To, con el asunto dado", async () => {
    const fetchImpl = okFetch();
    await sendEmailReply(db(null).client, {
      workspaceId: WS, conversationId: CONV, channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false, subject: "Novedades",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.subject).toBe("Novedades");
    expect(body.headers).toEqual({});
  });

  it("la key de Resend no aparece en el resultado", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "nope" }), { status: 422 }));
    const res = await sendEmailReply(db().client, {
      workspaceId: WS, conversationId: CONV, channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(KEY);
  });
});
