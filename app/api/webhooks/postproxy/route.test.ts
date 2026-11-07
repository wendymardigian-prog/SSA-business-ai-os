/**
 * El receptor de Postproxy (F35). La URL es publica: sin secreto guardado o con un token que no coincide no se
 * marca ninguna publicacion, y el mismo aviso dos veces se aplica una sola.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const { createServiceClient, readSecret, settlePublication } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  readSecret: vi.fn(),
  settlePublication: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});
// Interpretar el payload es real; aplicar el aviso a la fila tiene su propio test.
vi.mock("@/lib/publishing/inbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishing/inbound")>();
  return { ...actual, settlePublication };
});

import { POST } from "./route";

const WS = "ws-1";
const SECRET = "secreto-de-postproxy-de-prueba";
const EVENT = { post_id: "pp-123", status: "published", url: "https://youtube.example.test/v/1", external_id: "v1" };

let db: MemoryDb;

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://app.example.test/api/webhooks/postproxy", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(
    {
      social_posts: [{ id: "sp-1", workspace_id: WS, publisher_ref: "pp-123", deleted_at: null }],
      webhook_events: [],
    },
    { unique: { webhook_events: (a, b) => a.event_id === b.event_id } },
  );
  createServiceClient.mockResolvedValue(db.client);
  readSecret.mockResolvedValue(SECRET);
  settlePublication.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/postproxy", () => {
  it("sin secreto guardado, rechaza y no marca nada", async () => {
    readSecret.mockResolvedValue(null);

    const res = await POST(request(EVENT, { "x-webhook-token": SECRET }));

    expect(res.status).toBe(401);
    expect(settlePublication).not.toHaveBeenCalled();
    expect(db.rows("webhook_events")).toHaveLength(0);
  });

  it("sin token o con un token que no coincide, rechaza", async () => {
    const sinToken = await POST(request(EVENT));
    const malo = await POST(request(EVENT, { "x-webhook-token": "otro-secreto-cualquiera" }));
    const firmaMala = await POST(request(EVENT, { "x-postproxy-signature": "otro-secreto-cualquiera" }));

    expect([sinToken.status, malo.status, firmaMala.status]).toEqual([401, 401, 401]);
    expect(settlePublication).not.toHaveBeenCalled();
    // El secreto se busco en el workspace de la publicacion, no en uno que mande el pedido.
    expect(readSecret).toHaveBeenCalledWith(db.client, WS, "postproxy_webhook_secret");
  });

  it("con el token correcto aplica el aviso; el mismo aviso repetido no se aplica dos veces", async () => {
    const primero = await POST(request(EVENT, { "x-webhook-token": SECRET }));
    const segundo = await POST(request(EVENT, { "x-postproxy-signature": SECRET }));

    expect(primero.status).toBe(200);
    expect(await primero.json()).toEqual({ ok: true, settled: true });
    expect(segundo.status).toBe(200);
    expect(await segundo.json()).toEqual({ ok: true, skipped: "evento repetido" });
    expect(settlePublication).toHaveBeenCalledTimes(1);
    expect(db.rows("webhook_events").map((r) => r.event_id)).toEqual(["postproxy:pp-123:published"]);
  });

  it("una publicacion que no conoce no lee ningun secreto", async () => {
    const res = await POST(request({ ...EVENT, post_id: "pp-desconocida" }, { "x-webhook-token": SECRET }));

    expect(await res.json()).toEqual({ ok: true, skipped: "publicacion desconocida" });
    expect(readSecret).not.toHaveBeenCalled();
    expect(settlePublication).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON da 400 sin tocar la base", async () => {
    const res = await POST(request("no es json"));

    expect(res.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
