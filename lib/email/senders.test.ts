import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  composeAddress,
  normalizeDomain,
  parseSenderInput,
  senderFor,
  senderParts,
  splitAddress,
  unverifiedSenderWarning,
  validateSenderLocal,
  type ResendDomain,
} from "./senders";
import { describeEmailReadiness } from "./readiness";
import { listResendDomains, workspaceResendDomains, clearResendDomainsCache } from "./resend-domains";
import { sendTransactionalEmail } from "./send";
import { fakeDb } from "@/lib/testing/fake-db";

const KEY = "re_key_secreta_de_prueba_123456";
const DOMAINS: ResendDomain[] = [
  { name: "mail.wendymardigian.com", status: "verified" },
  { name: "news.wendymardigian.com", status: "verified" },
  { name: "wendymardigian.com", status: "pending" },
  { name: "viejo.com", status: "failed" },
];

describe("la direccion: usuario + dominio", () => {
  it("se arma y se separa", () => {
    expect(composeAddress(" hola ", "Mail.WendyMardigian.com")).toBe("hola@mail.wendymardigian.com");
    expect(splitAddress("app@wendymardigian.com")).toEqual({ local: "app", domain: "wendymardigian.com" });
    expect(splitAddress("sin-arroba")).toBeNull();
  });

  it("una config vieja (solo from_email) se separa al abrir la pantalla", () => {
    expect(senderParts({ from_email: "app@wendymardigian.com" }, "important")).toEqual({ local: "app", domain: "wendymardigian.com" });
    expect(senderParts({ from_local: "hola", from_domain: "mail.x.com", from_email: "otro@y.com" }, "important")).toEqual({ local: "hola", domain: "mail.x.com" });
    expect(senderParts({}, "marketing")).toEqual({ local: "", domain: "" });
  });

  it("el usuario: letras, numeros, punto, guion y guion bajo; sin @", () => {
    expect(validateSenderLocal("hola")).toBeNull();
    expect(validateSenderLocal("ventas.ar_1-x")).toBeNull();
    expect(validateSenderLocal("hola@x.com")).toMatch(/antes del @/);
    expect(validateSenderLocal("ho la")).toMatch(/solo puede tener/);
    expect(validateSenderLocal("ñandú")).toMatch(/solo puede tener/);
    expect(validateSenderLocal(".hola")).toMatch(/solo puede tener/);
    expect(validateSenderLocal("")).toMatch(/Escribí/);
  });

  it("un dominio escrito a mano tiene que tener forma de dominio", () => {
    expect(normalizeDomain("@Mail.Negocio.com.")).toBe("mail.negocio.com");
    expect(normalizeDomain("no es un dominio")).toBeNull();
  });
});

describe("guardar los remitentes", () => {
  it("con la lista: solo un dominio verificado; se guarda tambien el from_email compuesto", () => {
    const ok = parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", fromName: "Wendy" }, DOMAINS);
    expect(ok).toMatchObject({ ok: true, config: { from_local: "hola", from_domain: "mail.wendymardigian.com", from_email: "hola@mail.wendymardigian.com", from_name: "Wendy" } });
    expect(parseSenderInput({ fromLocal: "app", fromDomain: "wendymardigian.com" }, DOMAINS)).toMatchObject({ ok: false, error: expect.stringContaining("no está verificado") });
    expect(parseSenderInput({ fromLocal: "app", fromDomain: "otro.com" }, DOMAINS)).toMatchObject({ ok: false, error: expect.stringContaining("no está en tu cuenta") });
  });

  it("sin la lista (key solo envio): el dominio a mano alcanza con tener forma", () => {
    expect(parseSenderInput({ fromLocal: "hola", fromDomain: "mail.cualquiera.com" }, null)).toMatchObject({ ok: true });
  });

  it("marketing es opcional; si se completa, tambien tiene que ser un dominio verificado", () => {
    const both = parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", marketingLocal: "novedades", marketingDomain: "news.wendymardigian.com" }, DOMAINS);
    expect(both).toMatchObject({ ok: true, config: { marketing_from_email: "novedades@news.wendymardigian.com" } });
    expect(parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", marketingLocal: "n", marketingDomain: "viejo.com" }, DOMAINS)).toMatchObject({ ok: false });
    expect(parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com" }, DOMAINS)).toMatchObject({ ok: true, config: { marketing_from_email: "" } });
  });

  it("'Responder a' tiene que ser un email completo", () => {
    expect(parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", replyTo: "no-es" }, DOMAINS)).toMatchObject({ ok: false });
    expect(parseSenderInput({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", replyTo: "Wendy@Gmail.com" }, DOMAINS)).toMatchObject({ ok: true, config: { reply_to: "wendy@gmail.com" } });
  });
});

describe("el remitente segun la categoria", () => {
  const config = { from_email: "hola@mail.x.com", from_name: "Negocio", marketing_from_email: "novedades@news.x.com", reply_to: "equipo@x.com" };
  it("marketing sale del de marketing; transaccional del de importantes", () => {
    expect(senderFor(config, "marketing")).toEqual({ email: "novedades@news.x.com", name: "Negocio", replyTo: "equipo@x.com" });
    expect(senderFor(config, "transactional").email).toBe("hola@mail.x.com");
    expect(senderFor(config, undefined).email).toBe("hola@mail.x.com");
  });
  it("sin remitente de marketing, el de importantes", () => {
    expect(senderFor({ from_email: "hola@mail.x.com" }, "marketing").email).toBe("hola@mail.x.com");
  });

  it("sendTransactionalEmail usa el de marketing y manda el Responder a", async () => {
    const db = fakeDb(
      { "integration_configs:select": { data: { config, is_active: true, vault_secret_name: null } }, "email_log:insert": { data: null }, "workspaces:select": { data: { brand_name: "N" } } },
      { read_secret: { data: KEY }, email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "t", matched: true } } },
    );
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    await sendTransactionalEmail({ workspaceId: "ws", to: "a@x.test", subject: "s", html: "<p>h</p>", kind: "flow", category: "marketing", deps: { supabase: db.client, fetchImpl: fetchImpl as unknown as typeof fetch } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.from).toBe("Negocio <novedades@news.x.com>");
    expect(body.reply_to).toBe("equipo@x.com");
  });
});

describe("el aviso de un remitente con dominio sin verificar", () => {
  it("con la lista, en rojo y sin cambiar nada solo", () => {
    expect(unverifiedSenderWarning("app@wendymardigian.com", DOMAINS)).toBe(
      "Tu remitente actual (app@wendymardigian.com) usa un dominio que Resend no tiene verificado: los emails no están saliendo. Elegí un dominio verificado.",
    );
    expect(unverifiedSenderWarning("hola@mail.wendymardigian.com", DOMAINS)).toBeNull();
    expect(unverifiedSenderWarning("app@wendymardigian.com", null)).toBeNull();
  });

  it("readiness avisa ANTES de que falle un envio", () => {
    const r = describeEmailReadiness({ integration: { is_active: true, from_email: "app@wendymardigian.com" }, lastLog: null, domains: DOMAINS });
    expect(r).toMatchObject({ ok: false, reason: "rejected" });
    expect(describeEmailReadiness({ integration: { is_active: true, from_email: "hola@mail.wendymardigian.com" }, lastLog: null, domains: DOMAINS })).toEqual({ ok: true });
    // Sin lista, como antes.
    expect(describeEmailReadiness({ integration: { is_active: true, from_email: "app@wendymardigian.com" }, lastLog: null })).toEqual({ ok: true });
  });
});

describe("listar los dominios de Resend (fetch simulado)", () => {
  beforeEach(() => clearResendDomainsCache());
  const respond = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it("verificados y no verificados, con la key en la cabecera y nunca en el resultado", async () => {
    const fetchImpl = respond(200, { object: "list", data: [{ id: "1", name: "Mail.Wendymardigian.com", status: "verified" }, { id: "2", name: "wendymardigian.com", status: "pending" }] });
    const res = await listResendDomains(KEY, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, domains: [{ name: "mail.wendymardigian.com", status: "verified" }, { name: "wendymardigian.com", status: "pending" }] });
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("una key solo de envio (401/403): 'forbidden', no un error", async () => {
    expect(await listResendDomains(KEY, respond(401, { name: "restricted_api_key", message: "This API key is restricted to only send emails" }) as unknown as typeof fetch)).toEqual({ ok: false, reason: "forbidden" });
    expect(await listResendDomains(KEY, respond(403, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("Resend caido o sin red: 'failed', nunca lanza", async () => {
    expect(await listResendDomains(KEY, respond(500, {}) as unknown as typeof fetch)).toEqual({ ok: false, reason: "failed" });
    expect(await listResendDomains(KEY, vi.fn().mockRejectedValue(new Error("sin red")) as unknown as typeof fetch)).toEqual({ ok: false, reason: "failed" });
  });

  it("por workspace: la key sale de Vault (servidor); sin key, 'no_key'; la lista se guarda unos minutos", async () => {
    const withKey = fakeDb({}, { read_secret: { data: KEY } });
    const fetchImpl = respond(200, { data: [{ name: "a.com", status: "verified" }] });
    await workspaceResendDomains(withKey.client, "ws-1", { fetchImpl: fetchImpl as unknown as typeof fetch, now: 1000 });
    await workspaceResendDomains(withKey.client, "ws-1", { fetchImpl: fetchImpl as unknown as typeof fetch, now: 2000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await workspaceResendDomains(withKey.client, "ws-1", { fetchImpl: fetchImpl as unknown as typeof fetch, now: 3000, refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const noKey = fakeDb({}, { read_secret: { data: null } });
    expect(await workspaceResendDomains(noKey.client, "ws-2")).toEqual({ ok: false, reason: "no_key" });
  });
});

describe("sendEmailReply y el remitente de marketing", () => {
  it("marketing con remitente propio: sale de ahi y las respuestas vuelven al canal (Responder a)", async () => {
    const { sendEmailReply } = await import("./send-reply");
    const db = fakeDb(
      {
        "messages:select": { data: null },
        "integration_configs:select": { data: { config: { from_email: "hola@mail.x.com", marketing_from_email: "novedades@news.x.com", from_name: "Negocio" } } },
        "workspaces:select": { data: { brand_name: "N" } },
      },
      { read_secret: { data: KEY }, email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "t", matched: true } } },
    );
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const channel = { platform: "email", is_active: true, email_address: "bandeja@mail.x.com" };
    const base = { workspaceId: "ws", conversationId: "cv", channel, toAddress: "a@x.test", text: "Hola", contactOptedOut: false, fetchImpl: fetchImpl as unknown as typeof fetch };

    await sendEmailReply(db.client, { ...base, category: "marketing" });
    const marketing = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(marketing.from).toBe("Negocio <novedades@news.x.com>");
    expect(marketing.reply_to).toBe("bandeja@mail.x.com");

    await sendEmailReply(db.client, { ...base, category: "transactional" });
    const reply = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
    expect(reply.from).toBe("bandeja@mail.x.com");
    expect(reply).not.toHaveProperty("reply_to");
  });
});
