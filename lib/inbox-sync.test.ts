import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Zernio } from "./zernio-client";
import { backfillInboxConversations } from "./inbox-sync";

interface CapturedRow {
  table: string;
  row: Record<string, unknown>;
  options?: Record<string, unknown>;
}

/**
 * Fake Supabase client covering the query shapes used by the backfill:
 * conversations select (known late_conversation_ids), the find_or_link_contact
 * RPC that resolves the contact, the post-import contact stamp, and the
 * conversations upsert.
 *
 * The contact lookup moved into Postgres (migration 00025), so the fake
 * emulates the RPC's contract rather than the individual table reads: a sender
 * listed in `contactChannelBySender` comes back as `existed: true` with that
 * contact id; anyone else gets a freshly minted one.
 */
function makeFakeSupabase(seed: {
  existingConversationIds?: string[];
  contactChannelBySender?: Record<string, string>;
  /** Contact ids that already have a conversations row on the channel, so the
   * ignoreDuplicates upsert conflicts and returns no inserted rows. */
  conversationContactIds?: string[];
}) {
  const inserts: CapturedRow[] = [];
  const upserts: CapturedRow[] = [];
  const updates: CapturedRow[] = [];
  let contactSeq = 0;

  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn !== "find_or_link_contact") {
        return Promise.resolve({ data: null, error: null });
      }
      const known = seed.contactChannelBySender?.[args.p_sender_id as string];
      return Promise.resolve({
        data: {
          contact_id: known ?? `contact-${++contactSeq}`,
          existed: Boolean(known),
          linked_by: known ? "channel" : null,
          suggested_contact_id: null,
        },
        error: null,
      });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        single() {
          if (table === "contact_channels") {
            const contactId =
              seed.contactChannelBySender?.[filters.platform_sender_id as string];
            return Promise.resolve({
              data: contactId ? { contact_id: contactId } : null,
              error: contactId ? null : { code: "PGRST116" },
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          const data =
            table === "conversations"
              ? (seed.existingConversationIds ?? []).map((id) => ({
                  late_conversation_id: id,
                }))
              : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          if (table === "contacts") {
            const id = `contact-${++contactSeq}`;
            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: { id }, error: null }),
                };
              },
            };
          }
          return Promise.resolve({ data: null, error: null });
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
              Promise.resolve({
                data: conflicted ? [] : [{ id: `conv-${row.late_conversation_id}` }],
                error: null,
              }),
          };
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, inserts, upserts, updates, rpcCalls };
}

interface FakePage {
  data: Array<Record<string, unknown>>;
  pagination?: { hasMore?: boolean; nextCursor?: string | null };
}

/** Fake Zernio client returning one prepared page per listInboxConversations call. */
function fakeZernio(pages: FakePage[]) {
  let call = 0;
  const list = vi.fn().mockImplementation(() => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;
    return Promise.resolve({ data: page });
  });
  return {
    client: { messages: { listInboxConversations: list } } as unknown as Zernio,
    list,
  };
}

const channel = { id: "ch-1", late_account_id: "acc-1", platform: "instagram" };

const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  participantId: `sender-${id}`,
  participantName: `Sender ${id}`,
  participantUsername: `sender_${id}`,
  participantPicture: null,
  lastMessage: `hello from ${id}`,
  updatedTime: "2026-07-01T10:00:00.000Z",
  unreadCount: 2,
  ...extra,
});

describe("backfillInboxConversations", () => {
  it("imports missing conversations with contact + conversation rows", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      { data: [conv("c1"), conv("c2")], pagination: { hasMore: false } },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(2);
    expect(z.list).toHaveBeenCalledWith({
      query: { accountId: "acc-1", limit: 50, sortOrder: "desc", cursor: undefined },
    });

    // El alta del contacto, su contact_channels y el analytics_event los hace
    // find_or_link_contact adentro de la base; desde aca se verifica que se la
    // llame una vez por conversacion y con los datos del remitente.
    expect(fake.rpcCalls).toHaveLength(2);
    expect(fake.rpcCalls[0].fn).toBe("find_or_link_contact");
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_channel_id: "ch-1",
      p_sender_id: "sender-c1",
      p_display_name: "Sender c1",
      // El @usuario que manda Zernio tiene que llegar a la base: sin esto los
      // contactos importados quedaban sin usuario aunque el dato estuviera.
      p_username: "sender_c1",
      p_interaction_at: "2026-07-01T10:00:00.000Z",
      // El backfill no sella last_interaction_at de un contacto que ya existia:
      // lo hace despues, solo si la conversacion se importo de verdad.
      p_stamp_existing: false,
    });

    expect(fake.upserts).toHaveLength(2);
    expect(fake.upserts[0]).toMatchObject({
      table: "conversations",
      row: {
        workspace_id: "ws-1",
        channel_id: "ch-1",
        platform: "instagram",
        late_conversation_id: "c1",
        status: "open",
        last_message_at: "2026-07-01T10:00:00.000Z",
        last_message_preview: "hello from c1",
        unread_count: 2,
      },
      options: { onConflict: "channel_id,contact_id", ignoreDuplicates: true },
    });
  });

  it("imports archived Zernio conversations as closed, not open", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      {
        data: [conv("c1", { status: "archived" }), conv("c2", { status: "active" })],
        pagination: { hasMore: false },
      },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(2);
    expect(fake.upserts[0].row).toMatchObject({
      late_conversation_id: "c1",
      status: "closed",
    });
    expect(fake.upserts[1].row).toMatchObject({
      late_conversation_id: "c2",
      status: "open",
    });
  });

  it("keeps only the most recent conversation per contact within a run", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      {
        data: [conv("c1"), conv("c2", { participantId: "sender-c1" })],
        pagination: { hasMore: false },
      },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(1);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].row).toMatchObject({ late_conversation_id: "c1" });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("skips a webhook-owned row without counting it or bumping the contact's last_interaction_at", async () => {
    const fake = makeFakeSupabase({
      existingConversationIds: ["webhook-conv"],
      contactChannelBySender: { "sender-c1": "contact-existing" },
      conversationContactIds: ["contact-existing"],
    });
    const z = fakeZernio([{ data: [conv("c1")], pagination: { hasMore: false } }]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(0);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].options).toMatchObject({ ignoreDuplicates: true });
    expect(fake.updates.filter((u) => u.table === "contacts")).toHaveLength(0);
  });

  it("skips conversations already present locally (insert-only backfill)", async () => {
    const fake = makeFakeSupabase({ existingConversationIds: ["c1"] });
    const z = fakeZernio([
      { data: [conv("c1"), conv("c2")], pagination: { hasMore: false } },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(1);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].row).toMatchObject({ late_conversation_id: "c2" });
  });

  it("reuses an existing contact via contact_channels instead of creating one", async () => {
    const fake = makeFakeSupabase({
      contactChannelBySender: { "sender-c1": "contact-existing" },
    });
    const z = fakeZernio([{ data: [conv("c1")], pagination: { hasMore: false } }]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(1);
    expect(fake.rpcCalls[0].args).toMatchObject({ p_sender_id: "sender-c1" });
    expect(fake.updates.filter((u) => u.table === "contacts")).toHaveLength(1);
    expect(fake.updates[0].row).toMatchObject({
      last_interaction_at: "2026-07-01T10:00:00.000Z",
    });
    expect(fake.upserts[0].row).toMatchObject({ contact_id: "contact-existing" });
  });

  it("follows nextCursor while hasMore and stops when hasMore is false", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      { data: [conv("c1")], pagination: { hasMore: true, nextCursor: "cur-2" } },
      { data: [conv("c2")], pagination: { hasMore: false, nextCursor: null } },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(2);
    expect(z.list).toHaveBeenCalledTimes(2);
    expect(z.list).toHaveBeenNthCalledWith(2, {
      query: { accountId: "acc-1", limit: 50, sortOrder: "desc", cursor: "cur-2" },
    });
  });

  it("hard-caps pagination at 4 pages per channel", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      { data: [conv("c1")], pagination: { hasMore: true, nextCursor: "next" } },
    ]);

    await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(z.list).toHaveBeenCalledTimes(4);
  });

  it("skips items without an id or participantId", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      {
        data: [conv("c1"), { id: "c2" }, { participantId: "sender-x" }],
        pagination: { hasMore: false },
      },
    ]);

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(res.imported).toBe(1);
    expect(fake.upserts).toHaveLength(1);
  });

  it("continues with the next channel when one channel's listing fails", async () => {
    const fake = makeFakeSupabase({});
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("account disconnected"))
      .mockResolvedValueOnce({
        data: { data: [conv("c1")], pagination: { hasMore: false } },
      });
    const zernio = { messages: { listInboxConversations: list } } as unknown as Zernio;

    const res = await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio,
      workspaceId: "ws-1",
      channels: [
        { id: "ch-bad", late_account_id: "acc-bad", platform: "facebook" },
        channel,
      ],
    });

    expect(res.imported).toBe(1);
    expect(fake.upserts[0].row).toMatchObject({ channel_id: "ch-1" });
  });
});

describe("el @usuario del backfill", () => {
  it("pasa null cuando Zernio no lo manda, en vez de inventarlo", async () => {
    const fake = makeFakeSupabase({});
    const z = fakeZernio([
      { data: [conv("sin-user", { participantUsername: undefined })], pagination: { hasMore: false } },
    ]);

    await backfillInboxConversations({
      // En el test los dos son el mismo fake; lo que importa es que la firma
      // obligue a pasarlos por separado.
      service: fake.client,
      supabase: fake.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(fake.rpcCalls[0].args.p_username).toBeNull();
  });
});

describe("separacion de clientes en el backfill", () => {
  it("find_or_link_contact se llama con el service client, no con el del usuario", async () => {
    // find_or_link_contact quedo restringida al service role: no tiene control
    // de permisos propio, solo deriva el workspace del canal. Si el backfill
    // volviera a usar el cliente del usuario, el Inbox se quedaria vacio en
    // silencio (el fallo cae en un catch que solo loguea).
    const usuario = makeFakeSupabase({});
    const service = makeFakeSupabase({});
    const z = fakeZernio([{ data: [conv("c1")], pagination: { hasMore: false } }]);

    await backfillInboxConversations({
      supabase: usuario.client,
      service: service.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(service.rpcCalls.map((c) => c.fn)).toContain("find_or_link_contact");
    expect(usuario.rpcCalls.map((c) => c.fn)).not.toContain("find_or_link_contact");
  });

  it("las conversaciones se siguen escribiendo con el cliente del usuario, para que la RLS valide", async () => {
    const usuario = makeFakeSupabase({});
    const service = makeFakeSupabase({});
    const z = fakeZernio([{ data: [conv("c1")], pagination: { hasMore: false } }]);

    await backfillInboxConversations({
      supabase: usuario.client,
      service: service.client,
      zernio: z.client,
      workspaceId: "ws-1",
      channels: [channel],
    });

    expect(usuario.upserts.length + usuario.inserts.length).toBeGreaterThan(0);
    expect(service.upserts.length).toBe(0);
  });
});
