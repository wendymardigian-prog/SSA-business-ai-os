/**
 * F83: registrar un toque.
 *
 * Tres contratos, los tres importantes:
 *  1. Lo que se manda a la base ya está validado y normalizado.
 *  2. El `raw` es una lista blanca: un token o un dato personal no se cuela.
 *  3. NUNCA lanza. Un fallo de atribución no puede tumbar un mensaje.
 *
 * El cálculo del primero y del último toque y la idempotencia viven en la base
 * (`record_contact_touch`, 00114) y se prueban contra la base real en
 * `scripts/verify-attribution.mjs`: acá solo se prueba lo que hace TypeScript.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseTouch, recordTouch, sanitizeRaw, type TouchInput } from "./touch";

const WS = "ws-1";
const CONTACT = "contact-1";

const base: TouchInput = {
  source: "instagram",
  medium: "dm",
  origin: "dm",
  dedupeKey: "msg:123",
};

function fakeDb(result: { data?: unknown; error?: { message: string } | null } | "throws") {
  const rpc = vi.fn(async () => {
    if (result === "throws") throw new Error("la red se cayo");
    return { data: result.data ?? null, error: result.error ?? null };
  });
  return { client: { rpc } as never, rpc };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("parseTouch (F83)", () => {
  it("normaliza la fuente y el medio, y usa las claves de la base", () => {
    const parsed = parseTouch({ ...base, source: "IG", medium: "CPC" });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.touch).toMatchObject({
        source: "instagram",
        medium: "paid_social",
        origin: "dm",
        dedupe_key: "msg:123",
      });
      expect(parsed.touch.medium_raw).toBeUndefined();
    }
  });

  it("un medio desconocido se guarda crudo y marcado", () => {
    const parsed = parseTouch({ ...base, medium: "Podcast" });

    expect(parsed.ok && parsed.touch).toMatchObject({ medium: "podcast", medium_raw: true });
  });

  it("un utm_source fuera de la lista se conserva, no se descarta", () => {
    const parsed = parseTouch({ ...base, source: "Mi-Newsletter" });

    expect(parsed.ok && parsed.touch.source).toBe("mi-newsletter");
  });

  it("no manda campos vacíos: lo que no hay no viaja", () => {
    const parsed = parseTouch({ ...base, campaign: "  ", term: null, content: undefined });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.touch).not.toHaveProperty("campaign");
      expect(parsed.touch).not.toHaveProperty("term");
      expect(parsed.touch).not.toHaveProperty("content");
    }
  });

  it("pasa los identificadores de anuncio y la pieza", () => {
    const parsed = parseTouch({
      ...base,
      medium: "paid_social",
      adId: "ad-9",
      ctwaClid: "ctwa-1",
      socialPostId: "11111111-1111-4111-8111-111111111111",
      contentPostId: "22222222-2222-4222-8222-222222222222",
    });

    expect(parsed.ok && parsed.touch).toMatchObject({
      ad_id: "ad-9",
      ctwa_clid: "ctwa-1",
      social_post_id: "11111111-1111-4111-8111-111111111111",
      content_post_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("rechaza lo que no sirve, con el motivo", () => {
    expect(parseTouch({ ...base, source: "   " }).ok).toBe(false);
    expect(parseTouch({ ...base, dedupeKey: "" }).ok).toBe(false);
    expect(parseTouch({ ...base, origin: "telepatia" as never }).ok).toBe(false);
    expect(parseTouch({ ...base, socialPostId: "no-es-un-uuid" }).ok).toBe(false);
    expect(parseTouch({ ...base, occurredAt: "no-es-una-fecha" }).ok).toBe(false);
  });

  it("la fecha se manda en ISO", () => {
    const parsed = parseTouch({ ...base, occurredAt: new Date("2026-09-12T10:00:00Z") });

    expect(parsed.ok && parsed.touch.occurred_at).toBe("2026-09-12T10:00:00.000Z");
  });
});

describe("el raw es una lista blanca (F83)", () => {
  it("un token o un dato personal NO se guarda", () => {
    const raw = sanitizeRaw({
      message_id: "m-1",
      access_token: "EAAB-secreto",
      authorization: "Bearer abc",
      email: "alguien@example.com",
      phone: "+506 8888 8888",
      password: "nope",
    });

    expect(raw).toEqual({ message_id: "m-1" });
  });

  it("conserva el referral de un anuncio pero solo sus claves conocidas", () => {
    const raw = sanitizeRaw({
      referral: { ad_id: "ad-1", ctwa_clid: "c-1", source_url: "https://fb.com/ad", user_token: "secreto" },
    });

    expect(raw).toEqual({ referral: { ad_id: "ad-1", ctwa_clid: "c-1", source_url: "https://fb.com/ad" } });
  });

  it("recorta los textos largos", () => {
    const raw = sanitizeRaw({ headline: "x".repeat(5000) });

    expect((raw.headline as string).length).toBe(300);
  });

  it("no baja más de dos niveles: ahí es donde se esconde lo que no se quiere", () => {
    const raw = sanitizeRaw({ referral: { utm: { deep: { source: "profundo" } } } });

    expect(JSON.stringify(raw)).not.toContain("profundo");
  });

  it("lo que no es un objeto da un objeto vacío", () => {
    expect(sanitizeRaw(null)).toEqual({});
    expect(sanitizeRaw("texto")).toEqual({});
    expect(sanitizeRaw([1, 2])).toEqual({});
  });

  it("recordTouch aplica la lista blanca antes de mandar", async () => {
    const { client, rpc } = fakeDb({ data: { inserted: true } });

    await recordTouch(client, {
      workspaceId: WS,
      contactId: CONTACT,
      touch: { ...base, raw: { message_id: "m-1", access_token: "EAAB-secreto" } },
    });

    const sent = JSON.stringify(rpc.mock.calls[0]);
    expect(sent).toContain("m-1");
    expect(sent).not.toContain("EAAB-secreto");
  });
});

describe("recordTouch (F83)", () => {
  it("llama a la función de la base con el workspace, el contacto y el toque limpio", async () => {
    const { client, rpc } = fakeDb({ data: { inserted: true, touch_id: "t-1" } });

    const result = await recordTouch(client, { workspaceId: WS, contactId: CONTACT, touch: base });

    expect(result).toEqual({ recorded: true, reason: undefined });
    expect(rpc).toHaveBeenCalledWith("record_contact_touch", {
      p_workspace_id: WS,
      p_contact_id: CONTACT,
      p_touch: expect.objectContaining({ source: "instagram", medium: "dm", origin: "dm", dedupe_key: "msg:123" }),
    });
  });

  it("el mismo toque dos veces: la segunda dice que no quedó una fila nueva", async () => {
    const { client } = fakeDb({ data: { inserted: false, reason: "duplicate" } });

    const result = await recordTouch(client, { workspaceId: WS, contactId: CONTACT, touch: base });

    expect(result).toEqual({ recorded: false, reason: "duplicate" });
  });

  it("un toque inválido no llega a la base", async () => {
    const { client, rpc } = fakeDb({ data: { inserted: true } });

    const result = await recordTouch(client, { workspaceId: WS, contactId: CONTACT, touch: { ...base, source: "" } });

    expect(result.recorded).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("NUNCA lanza: si la base devuelve un error, lo loguea y sigue", async () => {
    const { client } = fakeDb({ error: { message: "permission denied" } });

    const result = await recordTouch(client, { workspaceId: WS, contactId: CONTACT, touch: base });

    expect(result).toEqual({ recorded: false, reason: "error" });
    expect(console.error).toHaveBeenCalled();
  });

  it("NUNCA lanza: si el cliente EXPLOTA (la red se cae), tampoco", async () => {
    const { client } = fakeDb("throws");

    await expect(
      recordTouch(client, { workspaceId: WS, contactId: CONTACT, touch: base }),
    ).resolves.toEqual({ recorded: false, reason: "error" });
  });

  it("el log de un error no lleva el contenido del toque", async () => {
    const { client } = fakeDb({ error: { message: "boom" } });

    await recordTouch(client, {
      workspaceId: WS,
      contactId: CONTACT,
      touch: { ...base, campaign: "campana-secreta", raw: { message_id: "m-privado" } },
    });

    const logged = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("campana-secreta");
    expect(logged).not.toContain("m-privado");
  });
});
