import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const sync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fathom/ingest", () => ({ syncFathomConnection: sync }));

import { handleFathomSync } from "./fathom-sync";

const CONN = "11111111-1111-4111-8111-111111111111";
const ctx = (payload: Record<string, unknown>) => {
  const db = fakeDb();
  return { db, ctx: { supabase: db.client, job: { id: "j1", type: "fathom_sync", payload, attempts: 0 } } as never };
};

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("handleFathomSync", () => {
  it("sincroniza la conexion del payload", async () => {
    sync.mockResolvedValue({ outcome: "complete", ingested: 2, skippedExisting: 0, skippedNotCloser: 1, requests: 3 });
    const { ctx: c } = ctx({ connectionId: CONN });
    await handleFathomSync(c);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ supabase: expect.anything() }), CONN);
  });

  it("sin conexion en el payload no hace nada ni lanza", async () => {
    const { ctx: c } = ctx({});
    await expect(handleFathomSync(c)).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it("un fallo inesperado NO lanza (la cola reintentaria encima de la espera propia): lo anota", async () => {
    sync.mockRejectedValue(new Error("boom"));
    const { ctx: c, db } = ctx({ connectionId: CONN });
    await expect(handleFathomSync(c)).resolves.toBeUndefined();
    expect(db.writesTo("oauth_connections")[0].values).toEqual({ sync_last_error: "Falló la consulta a Fathom" });
  });

  it("el log solo lleva numeros, nunca datos de la llamada", async () => {
    sync.mockResolvedValue({ outcome: "complete", ingested: 1, skippedExisting: 0, skippedNotCloser: 0, requests: 2 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleFathomSync(ctx({ connectionId: CONN }).ctx);
    expect(String(spy.mock.calls[0][0])).toMatch(/^\[fathom_sync\] complete · nuevas 1/);
  });
});
