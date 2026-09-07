import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "./send";

const WS = "11111111-1111-1111-1111-111111111111";
const KEY = "re_una_key_secreta_que_no_debe_filtrarse";

/**
 * Cliente falso: responde la fila de integration_configs que se le diga,
 * devuelve la key por RPC y anota los inserts en email_log.
 */
function fakeClient(opts: {
  integration?: {
    config: Record<string, string>;
    is_active: boolean;
    vault_secret_name?: string | null;
  } | null;
  secret?: string | null;
  secretError?: string;
}) {
  const logged: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === "email_log") {
        return {
          insert: (row: Record<string, unknown>) => {
            logged.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      // integration_configs: cadena de .eq() que termina en .maybeSingle()
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: opts.integration ?? null, error: null }),
      };
      return chain;
    },
    rpc: vi.fn().mockResolvedValue(
      opts.secretError
        ? { data: null, error: { message: opts.secretError } }
        : { data: opts.secret ?? null, error: null },
    ),
  } as unknown as SupabaseClient;

  return { client, logged };
}

const CONNECTED = {
  config: { from_email: "hola@tudominio.com", from_name: "Mi Negocio" },
  is_active: true,
};

function baseParams(client: SupabaseClient, fetchImpl?: typeof fetch) {
  return {
    workspaceId: WS,
    to: "alguien@ejemplo.com",
    subject: "Te invitaron",
    html: "<p>hola</p>",
    kind: "team_invite" as const,
    deps: { supabase: client, fetchImpl },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.restoreAllMocks());

describe("sendTransactionalEmail con Resend no conectado", () => {
  it("no lanza y avisa que no esta configurado", async () => {
    const { client, logged } = fakeClient({ integration: null });
    const res = await sendTransactionalEmail(baseParams(client));

    expect(res).toEqual({
      ok: false,
      reason: "not_configured",
      error: "Resend no esta conectado",
    });
    expect(logged[0]).toMatchObject({ status: "skipped_not_configured", kind: "team_invite" });
  });

  it("una integracion desactivada cuenta como no conectada", async () => {
    const { client, logged } = fakeClient({
      integration: { ...CONNECTED, is_active: false },
      secret: KEY,
    });
    const res = await sendTransactionalEmail(baseParams(client));

    expect(res.ok).toBe(false);
    expect(logged[0]).toMatchObject({ status: "skipped_not_configured" });
  });

  it("conectada pero sin remitente: tampoco se manda nada", async () => {
    const { client, logged } = fakeClient({
      integration: { config: {}, is_active: true },
      secret: KEY,
    });
    const fetchImpl = vi.fn();
    const res = await sendTransactionalEmail(baseParams(client, fetchImpl as unknown as typeof fetch));

    expect(res).toMatchObject({ reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logged[0]).toMatchObject({ status: "skipped_not_configured" });
  });

  it("conectada pero sin key en Vault: no se rompe", async () => {
    const { client, logged } = fakeClient({ integration: CONNECTED, secret: null });
    const res = await sendTransactionalEmail(baseParams(client));

    expect(res).toMatchObject({ reason: "not_configured" });
    expect(logged[0]).toMatchObject({ status: "skipped_not_configured" });
  });

  it("un error de permisos leyendo Vault no tumba la operacion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ integration: CONNECTED, secretError: "forbidden" });
    const res = await sendTransactionalEmail(baseParams(client));

    expect(res).toMatchObject({ ok: false, reason: "not_configured" });
  });
});

describe("sendTransactionalEmail con Resend conectado", () => {
  it("manda el email y registra el id del proveedor", async () => {
    const { client, logged } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg_123" }));

    const res = await sendTransactionalEmail(
      baseParams(client, fetchImpl as unknown as typeof fetch),
    );

    expect(res).toEqual({ ok: true, id: "msg_123" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({
      status: "sent",
      provider_message_id: "msg_123",
      attempts: 1,
    });
  });

  it("arma el remitente con nombre y direccion, y manda la key en el header", async () => {
    const { client } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg_1" }));

    await sendTransactionalEmail(baseParams(client, fetchImpl as unknown as typeof fetch));

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).from).toBe("Mi Negocio <hola@tudominio.com>");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("sin nombre de remitente manda solo la direccion", async () => {
    const { client } = fakeClient({
      integration: { config: { from_email: "hola@tudominio.com" }, is_active: true },
      secret: KEY,
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg_1" }));

    await sendTransactionalEmail(baseParams(client, fetchImpl as unknown as typeof fetch));

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).from).toBe("hola@tudominio.com");
  });
});

describe("reintentos", () => {
  it("reintenta 3 veces ante un 500 y despues registra el fallo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, logged } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { message: "server error" }));

    const res = await sendTransactionalEmail(
      baseParams(client, fetchImpl as unknown as typeof fetch),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ ok: false, reason: "failed" });
    expect(logged[0]).toMatchObject({ status: "failed", attempts: 3 });
  }, 10_000);

  it("no reintenta ante un 401: la key esta mal y reintentar no lo arregla", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, logged } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { message: "API key is invalid" }));

    const res = await sendTransactionalEmail(
      baseParams(client, fetchImpl as unknown as typeof fetch),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, reason: "failed" });
    expect(logged[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("reintenta ante un error de red y sale bien en el segundo intento", async () => {
    const { client, logged } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(jsonResponse(200, { id: "msg_ok" }));

    const res = await sendTransactionalEmail(
      baseParams(client, fetchImpl as unknown as typeof fetch),
    );

    expect(res).toEqual({ ok: true, id: "msg_ok" });
    expect(logged[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});

describe("la API key nunca se filtra", () => {
  it("no aparece en el resultado, en el log de la base ni en consola", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.map(String).join(" "));
    });

    const { client, logged } = fakeClient({ integration: CONNECTED, secret: KEY });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { message: "domain not verified" }));

    const res = await sendTransactionalEmail(
      baseParams(client, fetchImpl as unknown as typeof fetch),
    );

    expect(JSON.stringify(res)).not.toContain(KEY);
    expect(JSON.stringify(logged)).not.toContain(KEY);
    expect(errors.join(" ")).not.toContain(KEY);
  });
});
