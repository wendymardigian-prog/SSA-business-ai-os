import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification, createNotificationOnce } from "./create";

interface World {
  insertError?: { message: string };
  existing?: unknown[];
  selectError?: { message: string };
  throwOnInsert?: boolean;
}

function fakeClient(world: World = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const filters: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    is: (col: string, val: unknown) => {
      filters[`${col}:is`] = val;
      return builder;
    },
    gte: (col: string, val: unknown) => {
      filters[`${col}:gte`] = val;
      return builder;
    },
    limit: () => builder,
    insert: async (row: Record<string, unknown>) => {
      if (world.throwOnInsert) throw new Error("boom");
      inserted.push(row);
      return { error: world.insertError ?? null };
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: world.existing ?? [], error: world.selectError ?? null }),
  };

  return {
    client: { from: () => builder } as unknown as SupabaseClient<Database>,
    inserted,
    filters,
  };
}

const BASE = {
  workspaceId: "ws-1",
  type: "human_takeover" as const,
  title: "Alguien necesita que le contesten",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createNotification", () => {
  it("guarda el aviso con su entidad y su destinatario", async () => {
    const { client, inserted } = fakeClient();

    const ok = await createNotification({
      supabase: client,
      ...BASE,
      body: "Abrila y segui vos.",
      entityType: "conversation",
      entityId: "conv-1",
      recipientId: "user-1",
      metadata: { contact_id: "c-1" },
    });

    expect(ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      workspace_id: "ws-1",
      type: "human_takeover",
      entity_type: "conversation",
      entity_id: "conv-1",
      recipient_id: "user-1",
    });
  });

  it("sin destinatario queda para los admins (null, no vacio)", async () => {
    const { client, inserted } = fakeClient();

    await createNotification({ supabase: client, ...BASE });

    // NULL significa "para los Owner/Admin", y es la RLS la que lo interpreta.
    expect(inserted[0].recipient_id).toBeNull();
    expect(inserted[0].entity_id).toBeNull();
  });

  /**
   * Lo mas importante de este modulo: un aviso que falla no puede tumbar la
   * operacion que lo genero. Que nadie se entere de que se derivo una
   * conversacion es malo; que la conversacion no se derive, peor.
   */
  it("si el insert falla, devuelve false pero NO lanza", async () => {
    const { client } = fakeClient({ insertError: { message: "rls" } });

    await expect(
      createNotification({ supabase: client, ...BASE }),
    ).resolves.toBe(false);
  });

  it("si el cliente explota, tampoco lanza", async () => {
    const { client } = fakeClient({ throwOnInsert: true });

    await expect(
      createNotification({ supabase: client, ...BASE }),
    ).resolves.toBe(false);
  });
});

describe("createNotificationOnce", () => {
  it("no repite si ya hay uno sin leer de la misma entidad", async () => {
    // Un canal que rebota generaria un aviso por cada corrida del cron y la
    // campana dejaria de servir.
    const { client, inserted } = fakeClient({ existing: [{ id: "n-1" }] });

    const ok = await createNotificationOnce({
      supabase: client,
      ...BASE,
      type: "channel_disconnected",
      entityId: "chan-1",
    });

    expect(ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("si el anterior ya fue leido, el problema que vuelve SI es noticia", async () => {
    // La consulta filtra por read_at IS NULL, asi que un leido no la frena.
    const { client, inserted, filters } = fakeClient({ existing: [] });

    const ok = await createNotificationOnce({
      supabase: client,
      ...BASE,
      type: "channel_disconnected",
      entityId: "chan-1",
    });

    expect(ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(filters["read_at:is"]).toBeNull();
  });

  it("si no puede chequear, crea igual: repetir molesta menos que faltar", async () => {
    const { client, inserted } = fakeClient({ selectError: { message: "timeout" } });

    const ok = await createNotificationOnce({
      supabase: client,
      ...BASE,
      entityId: "chan-1",
    });

    expect(ok).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("mira solo dentro de la ventana pedida", async () => {
    const { client, filters } = fakeClient({ existing: [] });

    await createNotificationOnce({
      supabase: client,
      ...BASE,
      entityId: "chan-1",
      withinMinutes: 30,
    });

    const desde = new Date(String(filters["created_at:gte"])).getTime();
    const esperado = Date.now() - 30 * 60 * 1000;
    expect(Math.abs(desde - esperado)).toBeLessThan(5000);
  });
});

describe("createNotificationOnce: perRecipient", () => {
  it("sin perRecipient no mira el destinatario (como siempre)", async () => {
    const { client, filters } = fakeClient({ existing: [] });
    await createNotificationOnce({ supabase: client, ...BASE, entityId: "e-1", recipientId: "u-1" });
    expect(filters["recipient_id"]).toBeUndefined();
  });

  it("con perRecipient filtra por destinatario: otro destinatario recibe su aviso", async () => {
    const { client, filters, inserted } = fakeClient({ existing: [] });
    const ok = await createNotificationOnce({ supabase: client, ...BASE, entityId: "e-1", recipientId: "u-2", perRecipient: true });
    expect(ok).toBe(true);
    expect(filters["recipient_id"]).toBe("u-2");
    expect(inserted).toHaveLength(1);
  });

  it("con perRecipient y un aviso ya existente para ESA persona, no repite", async () => {
    const { client, inserted } = fakeClient({ existing: [{ id: "n1" }] });
    const ok = await createNotificationOnce({ supabase: client, ...BASE, entityId: "e-1", recipientId: "u-2", perRecipient: true });
    expect(ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });
});
