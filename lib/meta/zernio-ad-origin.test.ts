import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  AD_ORIGIN_RETRY_MINUTES,
  ZERNIO_AD_ORIGIN_JOB,
  adOriginDedupeKey,
  adOriginFromConversation,
  adOriginRetryDelayMinutes,
  isRetryableZernioFailure,
  maybeEnqueueAdOriginLookup,
  originContextWithAd,
  runZernioAdOrigin,
  shouldLookUpAdOrigin,
  type AdOriginPayload,
  type EnqueueParams,
} from "./zernio-ad-origin";

const recordInboundTouch = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/contacts/touch-inbound", () => ({ recordInboundTouch }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioKeyState: vi.fn(async () => ({ state: "present", key: "k" })) }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: vi.fn() }));

const CONVERSATION = { data: { data: { id: "c1", metadata: { meta_ad_id: "120001", meta_ad_title: "Oferta de octubre", meta_ad_post_id: "17900" } } } };

describe("adOriginFromConversation", () => {
  it("lee el anuncio de la respuesta del SDK, del cuerpo y de la conversación sola", () => {
    const expected = { adId: "120001", title: "Oferta de octubre", postId: "17900" };
    expect(adOriginFromConversation(CONVERSATION)).toEqual(expected);
    expect(adOriginFromConversation(CONVERSATION.data)).toEqual(expected);
    expect(adOriginFromConversation(CONVERSATION.data.data)).toEqual(expected);
  });
  it("sin meta_ad_id (conversación orgánica) o con basura, devuelve null y no lanza", () => {
    expect(adOriginFromConversation({ data: { data: { metadata: { meta_ad_title: "x" } } } })).toBeNull();
    expect(adOriginFromConversation({ data: { data: { id: "c1" } } })).toBeNull();
    for (const junk of [null, undefined, 4, "x", [], { data: null }, { metadata: "x" }]) expect(adOriginFromConversation(junk)).toBeNull();
  });
  it("un meta_ad_id que no es texto no cuenta; los vacíos se limpian", () => {
    expect(adOriginFromConversation({ metadata: { meta_ad_id: 120001 } })).toBeNull();
    expect(adOriginFromConversation({ metadata: { meta_ad_id: " 99 ", meta_ad_title: "  ", meta_ad_post_id: "" } })).toEqual({ adId: "99", title: null, postId: null });
  });
});

describe("shouldLookUpAdOrigin", () => {
  const base = { platform: "instagram", hasReferral: false, inboundCount: 1, hasLateConversationId: true, hasPlatformMessageId: true };
  it("pregunta solo con el primer mensaje de Instagram que no trajo anuncio", () => {
    expect(shouldLookUpAdOrigin(base)).toBe(true);
    expect(shouldLookUpAdOrigin({ ...base, platform: "whatsapp" })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, platform: "email" })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, hasReferral: true })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, inboundCount: 2 })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, inboundCount: 0 })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, hasLateConversationId: false })).toBe(false);
    expect(shouldLookUpAdOrigin({ ...base, hasPlatformMessageId: false })).toBe(false);
  });
});

describe("reintentos", () => {
  it("1, 5 y 15 minutos y después se termina", () => {
    expect(AD_ORIGIN_RETRY_MINUTES).toEqual([1, 5, 15]);
    expect([1, 2, 3].map(adOriginRetryDelayMinutes)).toEqual([1, 5, 15]);
    expect(adOriginRetryDelayMinutes(4)).toBeNull();
  });
  it("reintenta un límite de uso, un error del servidor o la red; no un 401 ni un 404", () => {
    expect(isRetryableZernioFailure({ statusCode: 429 })).toBe(true);
    expect(isRetryableZernioFailure({ statusCode: 503 })).toBe(true);
    expect(isRetryableZernioFailure(new Error("fetch failed"))).toBe(true);
    expect(isRetryableZernioFailure({ statusCode: 401 })).toBe(false);
    expect(isRetryableZernioFailure({ statusCode: 404 })).toBe(false);
  });
});

describe("originContextWithAd", () => {
  const ad = { adId: "120001", title: "Oferta", postId: null };
  it("suma el anuncio y conserva el resto", () => {
    expect(originContextWithAd({ story_mention: true }, ad)).toEqual({ story_mention: true, ad: { ad_id: "120001", title: "Oferta", platform: "instagram" } });
    expect(originContextWithAd(null, ad)).toEqual({ ad: { ad_id: "120001", title: "Oferta", platform: "instagram" } });
  });
  it("si el mensaje ya tenía un anuncio, queda igual", () => {
    const existing = { ad: { ad_id: "777", platform: "instagram" } };
    expect(originContextWithAd(existing, ad)).toEqual(existing);
  });
});

// ── La base simulada: lo justo para las consultas que hace el módulo ────────────

function fakeDb(opts: { inboundCount?: number; originContext?: unknown; rpcResult?: { data?: unknown; error?: { message: string } | null } } = {}) {
  const updates: Array<{ table: string; values: unknown; id: unknown }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const jobs: Array<{ type: string; payload: Record<string, unknown>; runAt: Date; dedupeKey?: string }> = [];
  const db = {
    from(table: string) {
      return {
        select(_cols: string, o?: { count?: string; head?: boolean }) {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            maybeSingle: async () => ({ data: { origin_context: opts.originContext ?? null }, error: null }),
            then: (resolve: (v: unknown) => unknown) => resolve({ count: o?.head ? (opts.inboundCount ?? 1) : null, error: null }),
          };
          return chain;
        },
        update(values: unknown) {
          return { eq: async (_col: string, id: unknown) => { updates.push({ table, values, id }); return { error: null }; } };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return opts.rpcResult ?? { data: { ok: true, changed: true }, error: null };
    },
  } as unknown as SupabaseClient<Database>;
  const schedule = vi.fn(async (_db: unknown, type: string, payload: Record<string, unknown>, runAt: Date, dedupeKey?: string) => {
    jobs.push({ type, payload, runAt, dedupeKey });
    return { id: "j1" };
  });
  return { db, updates, rpcCalls, jobs, schedule };
}

const PAYLOAD: AdOriginPayload = {
  workspaceId: "w1",
  contactId: "c1",
  conversationId: "conv1",
  channelId: "ch1",
  lateConversationId: "late1",
  lateAccountId: "acc1",
  messageId: "m1",
  platformMessageId: "pm1",
  messageAt: "2026-10-14T10:00:00.000Z",
};
const zernioWith = (impl: () => Promise<unknown>) => ({ messages: { getInboxConversation: vi.fn(impl) } }) as never;

describe("runZernioAdOrigin", () => {
  it("con un anuncio en la conversación: lo guarda en el mensaje y completa el toque del mensaje", async () => {
    const f = fakeDb({ originContext: { story_mention: true } });
    const outcome = await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => CONVERSATION), schedule: f.schedule });
    expect(outcome).toBe("enriched");
    expect(f.updates).toEqual([{ table: "messages", id: "m1", values: { origin_context: { story_mention: true, ad: { ad_id: "120001", title: "Oferta de octubre", post_id: "17900", platform: "instagram" } } } }]);
    expect(f.rpcCalls).toEqual([{ name: "enrich_touch_ad_origin", args: { p_workspace_id: "w1", p_dedupe_key: "msg:pm1", p_ad_id: "120001", p_title: "Oferta de octubre", p_post_id: "17900" } }]);
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it("pregunta por la conversación y la cuenta correctas", async () => {
    const f = fakeDb();
    const zernio = zernioWith(async () => CONVERSATION);
    await runZernioAdOrigin(f.db, PAYLOAD, { zernio, schedule: f.schedule });
    expect((zernio as { messages: { getInboxConversation: ReturnType<typeof vi.fn> } }).messages.getInboxConversation).toHaveBeenCalledWith({ path: { conversationId: "late1" }, query: { accountId: "acc1" } });
  });

  it("una conversación que no vino de un anuncio no toca nada", async () => {
    const f = fakeDb();
    const outcome = await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => ({ data: { data: { id: "c1" } } })), schedule: f.schedule });
    expect(outcome).toBe("no_ad");
    expect(f.updates).toEqual([]);
    expect(f.rpcCalls).toEqual([]);
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it("si el toque ya tenía un anuncio o una persona lo decidió, queda como estaba", async () => {
    const f = fakeDb({ rpcResult: { data: { ok: true, changed: false, reason: "already_has_ad" }, error: null } });
    expect(await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => CONVERSATION), schedule: f.schedule })).toBe("unchanged");
  });

  it("si el mensaje ya tenía un anuncio en su origen, no se reescribe", async () => {
    const f = fakeDb({ originContext: { ad: { ad_id: "777", platform: "instagram" } } });
    await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => CONVERSATION), schedule: f.schedule });
    expect(f.updates).toEqual([]);
  });

  it("un contacto que ya existía y abre otra conversación no tiene toque de ese mensaje: se anota uno con el anuncio", async () => {
    recordInboundTouch.mockClear();
    const f = fakeDb({ rpcResult: { data: { ok: false, error: "touch_not_found" }, error: null } });
    const outcome = await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => CONVERSATION), schedule: f.schedule });
    expect(outcome).toBe("recorded");
    expect(recordInboundTouch).toHaveBeenCalledTimes(1);
    const call = recordInboundTouch.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(call[1]).toMatchObject({
      workspaceId: "w1",
      contactId: "c1",
      conversationId: "conv1",
      platform: "instagram",
      contactExisted: true,
      platformMessageId: "pm1",
      referral: { adId: "120001", sourceType: "ad", title: "Oferta de octubre", postId: "17900" },
    });
    expect((call[1].messageAt as Date).toISOString()).toBe("2026-10-14T10:00:00.000Z");
  });

  it("un fallo de Zernio que se arregla esperando reagenda (1 minuto) y NO lanza", async () => {
    const f = fakeDb();
    const now = new Date("2026-10-14T12:00:00.000Z");
    const outcome = await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => { throw Object.assign(new Error("rate"), { statusCode: 429 }); }), schedule: f.schedule, now: () => now });
    expect(outcome).toBe("retry");
    expect(f.jobs).toHaveLength(1);
    expect(f.jobs[0]).toMatchObject({ type: ZERNIO_AD_ORIGIN_JOB, dedupeKey: adOriginDedupeKey("conv1") });
    expect(f.jobs[0].runAt.toISOString()).toBe("2026-10-14T12:01:00.000Z");
    expect(f.jobs[0].payload.attempt).toBe(2);
    expect(f.rpcCalls).toEqual([]);
  });

  it("el tercer intento fallido espera 15 minutos y el cuarto ya no reagenda", async () => {
    const failing = zernioWith(async () => { throw new Error("fetch failed"); });
    const now = new Date("2026-10-14T12:00:00.000Z");
    const third = fakeDb();
    expect(await runZernioAdOrigin(third.db, { ...PAYLOAD, attempt: 3 }, { zernio: failing, schedule: third.schedule, now: () => now })).toBe("retry");
    expect(third.jobs[0].runAt.toISOString()).toBe("2026-10-14T12:15:00.000Z");
    const fourth = fakeDb();
    expect(await runZernioAdOrigin(fourth.db, { ...PAYLOAD, attempt: 4 }, { zernio: failing, schedule: fourth.schedule, now: () => now })).toBe("gave_up");
    expect(fourth.schedule).not.toHaveBeenCalled();
  });

  it("un 404 o un 401 de Zernio no se reintenta", async () => {
    const f = fakeDb();
    expect(await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => { throw Object.assign(new Error("nf"), { statusCode: 404 }); }), schedule: f.schedule })).toBe("gave_up");
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it("un error de la base al completar el toque reagenda", async () => {
    const f = fakeDb({ rpcResult: { data: null, error: { message: "db caida" } } });
    expect(await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => CONVERSATION), schedule: f.schedule })).toBe("retry");
  });

  it("si no se puede reagendar, termina sin lanzar", async () => {
    const f = fakeDb();
    const schedule = vi.fn(async () => { throw new Error("cola caida"); }) as never;
    expect(await runZernioAdOrigin(f.db, PAYLOAD, { zernio: zernioWith(async () => { throw new Error("x"); }), schedule })).toBe("gave_up");
  });
});

describe("maybeEnqueueAdOriginLookup", () => {
  const params: EnqueueParams = {
    workspaceId: "w1",
    contactId: "c1",
    conversationId: "conv1",
    channelId: "ch1",
    lateConversationId: "late1",
    lateAccountId: "acc1",
    messageId: "m1",
    platformMessageId: "pm1",
    messageAt: "2026-10-14T10:00:00.000Z",
    platform: "instagram",
    hasReferral: false,
  };

  it("el primer mensaje de Instagram sin anuncio encola el job, con clave por conversación", async () => {
    const jobs: unknown[][] = [];
    const insert = vi.fn((row: Record<string, unknown>) => { jobs.push([row]); return { select: () => ({ single: async () => ({ data: { id: "j1" }, error: null }) }) }; });
    const db = {
      from(table: string) {
        if (table === "scheduled_jobs") return { insert };
        return { select: () => { const chain: Record<string, unknown> = { eq: () => chain, then: (resolve: (v: unknown) => unknown) => resolve({ count: 1, error: null }) }; return chain; } };
      },
    } as unknown as SupabaseClient<Database>;
    expect(await maybeEnqueueAdOriginLookup(db, params)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ type: ZERNIO_AD_ORIGIN_JOB, dedupe_key: "zernio-ad-origin:conv1" });
    expect((row.payload as AdOriginPayload).platformMessageId).toBe("pm1");
  });

  it("no encola con el segundo mensaje, con anuncio en el mensaje, ni fuera de Instagram", async () => {
    const make = (count: number) => {
      const insert = vi.fn();
      const db = {
        from(table: string) {
          if (table === "scheduled_jobs") return { insert };
          return { select: () => { const chain: Record<string, unknown> = { eq: () => chain, then: (resolve: (v: unknown) => unknown) => resolve({ count, error: null }) }; return chain; } };
        },
      } as unknown as SupabaseClient<Database>;
      return { db, insert };
    };
    const second = make(2);
    expect(await maybeEnqueueAdOriginLookup(second.db, params)).toBe(false);
    expect(second.insert).not.toHaveBeenCalled();
    const withAd = make(1);
    expect(await maybeEnqueueAdOriginLookup(withAd.db, { ...params, hasReferral: true })).toBe(false);
    const whatsapp = make(1);
    expect(await maybeEnqueueAdOriginLookup(whatsapp.db, { ...params, platform: "whatsapp" })).toBe(false);
    expect(whatsapp.insert).not.toHaveBeenCalled();
  });

  it("nunca lanza: un error de la base o un job repetido (23505) dan false", async () => {
    const boom = { from: () => { throw new Error("db caida"); } } as unknown as SupabaseClient<Database>;
    expect(await maybeEnqueueAdOriginLookup(boom, params)).toBe(false);
    const dup = {
      from(table: string) {
        if (table === "scheduled_jobs") return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: Object.assign(new Error("dup"), { code: "23505" }) }) }) }) };
        return { select: () => { const chain: Record<string, unknown> = { eq: () => chain, then: (resolve: (v: unknown) => unknown) => resolve({ count: 1, error: null }) }; return chain; } };
      },
    } as unknown as SupabaseClient<Database>;
    expect(await maybeEnqueueAdOriginLookup(dup, params)).toBe(false);
  });
});
