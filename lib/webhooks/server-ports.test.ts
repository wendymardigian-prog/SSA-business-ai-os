/**
 * El puerto de base del receptor: guardar un envío es UNA llamada a `receive_inbound_webhook` (00216), con candado.
 * Acá la base se simula (`rpc`): se prueba el contrato con la función, no el candado (eso lo prueba
 * `scripts/verify-inbound-webhooks.mjs` contra la base real, con entregas en paralelo).
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DUPLICATE_WINDOW_MS, type InboundInsert } from "./receive";
import { receiveDeps } from "./server-ports";

const row: InboundInsert = {
  workspaceId: "ws-1",
  endpointId: "ep-1",
  status: "received",
  payload: { email: "a@b.com" },
  query: { utm_source: "fb" },
  contentType: "application/json",
  sizeBytes: 21,
  ipPrefix: "203.0.113.0/24",
  userAgent: "Typeform/1.0",
  externalEventId: null,
  bodyHash: "h-1",
  errorMessage: null,
  summary: null,
  duplicateWindowMs: DUPLICATE_WINDOW_MS,
};

function fakeDb(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult);
  const updates: Record<string, unknown>[] = [];
  const db = {
    rpc,
    from: () => ({ update: (values: Record<string, unknown>) => ({ eq: async () => (updates.push(values), { error: null }) }) }),
  } as unknown as SupabaseClient<Database>;
  return { db, rpc, updates };
}

const deps = (db: SupabaseClient<Database>) => receiveDeps(db, new Request("https://app.test/api/hooks/x", { method: "POST" }));

describe("insertInbound (receive_inbound_webhook)", () => {
  it("llama a la función una sola vez, con la ventana en segundos y todo lo del envío", async () => {
    const { db, rpc } = fakeDb({ data: { kind: "inserted", id: "in-1", status: "received" }, error: null });
    await deps(db).insertInbound(row);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0] as unknown as [string, { p_row: Record<string, unknown>; p_duplicate_window_seconds: number }];
    expect(name).toBe("receive_inbound_webhook");
    expect(args.p_duplicate_window_seconds).toBe(600);
    expect(args.p_row).toMatchObject({ workspace_id: "ws-1", endpoint_id: "ep-1", status: "received", body_hash: "h-1", external_event_id: null, payload: { email: "a@b.com" } });
  });

  it("devuelve el estado FINAL que dejó la base: un repetido vuelve `ignored`", async () => {
    const { db } = fakeDb({ data: { kind: "inserted", id: "in-2", status: "ignored" }, error: null });
    expect(await deps(db).insertInbound(row)).toEqual({ kind: "inserted", id: "in-2", status: "ignored" });
  });

  it("el mismo id de envío por segunda vez es `duplicate` y no toca `last_received_at`", async () => {
    const { db, updates } = fakeDb({ data: { kind: "duplicate" }, error: null });
    expect(await deps(db).insertInbound(row)).toEqual({ kind: "duplicate" });
    expect(updates).toHaveLength(0);
  });

  it("si la base falla LANZA (el receptor responde 500 y el emisor reintenta); nunca lo toma por duplicado", async () => {
    const { db } = fakeDb({ data: null, error: { message: "caida" } });
    await expect(deps(db).insertInbound(row)).rejects.toThrow("no pude guardar el envio");
  });

  it("una respuesta que no se entiende también lanza", async () => {
    const { db } = fakeDb({ data: { kind: "otra-cosa" }, error: null });
    await expect(deps(db).insertInbound(row)).rejects.toThrow("no pude guardar el envio");
  });

  it("al guardar, anota el último envío del endpoint", async () => {
    const { db, updates } = fakeDb({ data: { kind: "inserted", id: "in-1", status: "received" }, error: null });
    await deps(db).insertInbound(row);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("last_received_at");
  });
});
