import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { importInboxPage } from "./inbox-sync";

interface CapturedRow {
  table: string;
  row: Record<string, unknown>;
  options?: Record<string, unknown>;
}

/**
 * Cliente de Supabase falso con las formas que usa la importacion de una pagina:
 * la lectura de los ids conocidos (`select ... eq ... in`), la RPC
 * find_or_link_contact, el upsert de la conversacion y el sello del contacto.
 *
 * La busqueda del contacto vive en Postgres (00025): el falso emula su contrato.
 * Un remitente de `contactChannelBySender` vuelve con `existed: true` y ese id;
 * cualquier otro recibe uno nuevo.
 */
function makeFakeSupabase(seed: {
  existingConversationIds?: string[];
  contactChannelBySender?: Record<string, string>;
  /** Contactos que ya tienen fila en el canal: el upsert con ignoreDuplicates choca y no devuelve filas. */
  conversationContactIds?: string[];
}) {
  const upserts: CapturedRow[] = [];
  const updates: CapturedRow[] = [];
  const inFilters: Array<{ col: string; values: unknown[] }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let contactSeq = 0;

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const known = seed.contactChannelBySender?.[args.p_sender_id as string];
      return Promise.resolve({
        data: { contact_id: known ?? `contact-${++contactSeq}`, existed: Boolean(known) },
        error: null,
      });
    },
    from(table: string) {
      let inValues: unknown[] = [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in(col: string, values: unknown[]) {
          inFilters.push({ col, values });
          inValues = values;
          return builder;
        },
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          const data =
            table === "conversations"
              ? (seed.existingConversationIds ?? [])
                  .filter((id) => inValues.includes(id))
                  .map((id) => ({ late_conversation_id: id }))
              : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              updates.push({ table, row: patch });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        upsert(row: Record<string, unknown>, options?: Record<string, unknown>) {
          upserts.push({ table, row, options });
          const conflicted =
            options?.ignoreDuplicates === true &&
            (seed.conversationContactIds ?? []).includes(row.contact_id as string);
          return {
            select: () =>
              Promise.resolve({ data: conflicted ? [] : [{ id: `conv-${row.late_conversation_id}` }], error: null }),
          };
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, upserts, updates, inFilters, rpcCalls };
}

function makeZernio(pages: Array<Record<string, unknown>>) {
  const list = vi.fn();
  for (const page of pages) list.mockResolvedValueOnce({ data: page });
  return { list, zernio: { messages: { listInboxConversations: list } } as unknown as Zernio };
}

const channel = { id: "ch-1", late_account_id: "acc-1", platform: "instagram" };

function run(
  fake: ReturnType<typeof makeFakeSupabase>,
  zernio: Zernio,
  over: Partial<{ phase: "active" | "archived"; cursor: string | null }> = {},
) {
  return importInboxPage({
    service: fake.client,
    zernio,
    workspaceId: "ws-1",
    channel,
    phase: over.phase ?? "active",
    cursor: over.cursor ?? null,
    pageSize: 50,
  });
}

describe("importInboxPage", () => {
  it("importa las conversaciones que faltan, con su contacto y su fila", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([
      {
        data: [
          { id: "c1", participantId: "s1", participantName: "Ana", lastMessage: "hola", updatedTime: "2026-09-01T10:00:00Z", status: "active", unreadCount: 2 },
          { id: "c2", participantId: "s2", participantName: "Beto", status: "active" },
        ],
        pagination: { hasMore: true, nextCursor: "cur-2" },
      },
    ]);

    const res = await run(fake, z.zernio);

    expect(res).toEqual({ received: 2, imported: 2, hasMore: true, nextCursor: "cur-2", accountFailure: null });
    expect(z.list).toHaveBeenCalledWith({
      query: { accountId: "acc-1", limit: 50, sortOrder: "desc", status: "active" },
    });
    expect(fake.rpcCalls[0]).toMatchObject({
      fn: "find_or_link_contact",
      args: { p_channel_id: "ch-1", p_sender_id: "s1", p_display_name: "Ana", p_stamp_existing: false },
    });
    expect(fake.upserts[0]).toMatchObject({
      table: "conversations",
      row: {
        workspace_id: "ws-1",
        channel_id: "ch-1",
        late_conversation_id: "c1",
        status: "open",
        last_message_at: "2026-09-01T10:00:00Z",
        unread_count: 2,
      },
      options: { onConflict: "channel_id,contact_id", ignoreDuplicates: true },
    });
  });

  it("pide la fase y el cursor que le dicen", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([{ data: [], pagination: { hasMore: false } }]);

    const res = await run(fake, z.zernio, { phase: "archived", cursor: "cur-9" });

    expect(z.list).toHaveBeenCalledWith({
      query: { accountId: "acc-1", limit: 50, sortOrder: "desc", status: "archived", cursor: "cur-9" },
    });
    expect(res).toMatchObject({ received: 0, imported: 0, hasMore: false, nextCursor: null });
  });

  it("una archivada en Zernio entra cerrada, no abierta", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([{ data: [{ id: "c1", participantId: "s1", status: "archived" }] }]);

    await run(fake, z.zernio, { phase: "archived" });

    expect(fake.upserts[0].row).toMatchObject({ status: "closed" });
  });

  it("saltea las que ya estan, preguntando solo por los ids de esta pagina", async () => {
    const fake = makeFakeSupabase({ existingConversationIds: ["c1", "c-otra-pagina"] });
    const z = makeZernio([
      { data: [{ id: "c1", participantId: "s1" }, { id: "c2", participantId: "s2" }] },
    ]);

    const res = await run(fake, z.zernio);

    expect(fake.inFilters).toEqual([{ col: "late_conversation_id", values: ["c1", "c2"] }]);
    expect(res.imported).toBe(1);
    expect(fake.upserts.map((u) => u.row.late_conversation_id)).toEqual(["c2"]);
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("de la misma persona se queda con la mas reciente de la pagina", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([
      { data: [{ id: "c-nueva", participantId: "s1" }, { id: "c-vieja", participantId: "s1" }] },
    ]);

    const res = await run(fake, z.zernio);

    expect(res.imported).toBe(1);
    expect(fake.upserts.map((u) => u.row.late_conversation_id)).toEqual(["c-nueva"]);
  });

  it("una persona que ya tiene su conversacion (del webhook) no se cuenta ni se sella", async () => {
    const fake = makeFakeSupabase({
      contactChannelBySender: { s1: "contact-existente" },
      conversationContactIds: ["contact-existente"],
    });
    const z = makeZernio([{ data: [{ id: "c1", participantId: "s1" }] }]);

    const res = await run(fake, z.zernio);

    expect(res.imported).toBe(0);
    expect(fake.updates.filter((u) => u.table === "contacts")).toHaveLength(0);
  });

  it("un contacto conocido que gana su conversacion queda sellado con la fecha de Zernio", async () => {
    const fake = makeFakeSupabase({ contactChannelBySender: { s1: "contact-existente" } });
    const z = makeZernio([{ data: [{ id: "c1", participantId: "s1", updatedTime: "2026-08-01T00:00:00Z" }] }]);

    const res = await run(fake, z.zernio);

    expect(res.imported).toBe(1);
    expect(fake.updates).toEqual([{ table: "contacts", row: { last_interaction_at: "2026-08-01T00:00:00Z" } }]);
  });

  it("saltea lo que no tiene id o persona, pero lo cuenta como mirado", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([
      { data: [{ id: "c1" }, { participantId: "s2" }, { id: "c3", participantId: "s3" }] },
    ]);

    const res = await run(fake, z.zernio);

    expect(res).toMatchObject({ received: 3, imported: 1 });
  });

  it("pasa null como @usuario cuando Zernio no lo manda, en vez de inventarlo", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([{ data: [{ id: "c1", participantId: "s1", participantName: "Ana" }] }]);

    await run(fake, z.zernio);

    expect(fake.rpcCalls[0].args.p_username).toBeNull();
  });

  it("si Zernio avisa que la cuenta fallo, no importa nada y devuelve el motivo", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([
      {
        data: [],
        pagination: { hasMore: false },
        meta: { failedAccounts: [{ accountId: "acc-1", error: "Meta rate limit" }] },
      },
    ]);

    const res = await run(fake, z.zernio);

    expect(res).toMatchObject({ received: 0, imported: 0, hasMore: false, accountFailure: "Meta rate limit" });
    expect(fake.upserts).toHaveLength(0);
  });

  it("el aviso de falla de OTRA cuenta no frena esta", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([
      {
        data: [{ id: "c1", participantId: "s1" }],
        meta: { failedAccounts: [{ accountId: "otra", error: "x" }] },
      },
    ]);

    const res = await run(fake, z.zernio);

    expect(res).toMatchObject({ imported: 1, accountFailure: null });
  });

  it("no atrapa el error de Zernio: lo decide quien llama", async () => {
    const fake = makeFakeSupabase({});
    const list = vi.fn().mockRejectedValue(Object.assign(new Error("Too Many Requests"), { statusCode: 429 }));
    const zernio = { messages: { listInboxConversations: list } } as unknown as Zernio;

    await expect(run(fake, zernio)).rejects.toMatchObject({ statusCode: 429 });
  });

  it("hasMore sin cursor se toma como que no hay mas", async () => {
    const fake = makeFakeSupabase({});
    const z = makeZernio([{ data: [], pagination: { hasMore: true, nextCursor: null } }]);

    const res = await run(fake, z.zernio);

    expect(res.hasMore).toBe(false);
  });
});
