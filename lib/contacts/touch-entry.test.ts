/**
 * F87: los toques del alta manual y de la importación.
 *
 * Los armadores son puros: se prueba qué toque sale de cada vía. Y lo que
 * escribe en bloque no puede lanzar ni anotar de más.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { importTouch, manualTouch, recordImportTouches, recordManualTouch } from "./touch-entry";
import { parseTouch } from "./touch";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("el toque del alta manual (F87)", () => {
  it("sin UTM: fuente 'manual', origen manual, y la clave lleva al contacto", () => {
    expect(manualTouch("ct-1", null)).toMatchObject({ source: "manual", origin: "manual", dedupeKey: "manual:ct-1" });
  });

  it("con UTM: mandan, normalizadas", () => {
    const touch = manualTouch("ct-1", {
      utm_source: "IG", utm_medium: "cpc", utm_campaign: "octubre", utm_content: "reel-1", utm_term: "crm",
      fbclid: "fb1", ad_id: "ad1", referrer_url: "https://r.com", landing_page: "https://l.com",
    });
    const parsed = parseTouch(touch);

    expect(parsed.ok && parsed.touch).toMatchObject({
      source: "instagram", medium: "paid_social", campaign: "octubre", content: "reel-1", term: "crm",
      fbclid: "fb1", ad_id: "ad1", referrer_url: "https://r.com", landing_page: "https://l.com", origin: "manual",
    });
  });

  it("siempre es un toque válido para la base", () => {
    expect(parseTouch(manualTouch("ct-1", null)).ok).toBe(true);
  });
});

describe("el toque de la importación (F87)", () => {
  it("fuente csv, medio import, y la clave lleva la importación", () => {
    expect(importTouch("imp-1", "ct-1")).toMatchObject({
      source: "csv", medium: "import", origin: "import", dedupeKey: "import:imp-1:ct-1",
    });
  });

  it("el mismo contacto en dos importaciones distintas son dos claves", () => {
    expect(importTouch("imp-1", "ct-1").dedupeKey).not.toBe(importTouch("imp-2", "ct-1").dedupeKey);
  });

  it("es un toque válido para la base", () => {
    expect(parseTouch(importTouch("imp-1", "ct-1")).ok).toBe(true);
  });
});

describe("escribir los toques (F87)", () => {
  const fakeDb = (impl: () => unknown = () => ({ data: { inserted: true }, error: null })) => {
    const rpc = vi.fn(async () => impl());
    return { client: { rpc } as never, rpc };
  };

  it("un alta manual manda un toque con el contacto y el workspace", async () => {
    const { client, rpc } = fakeDb();

    await recordManualTouch(client, { workspaceId: "ws-1", contactId: "ct-1", tracking: null });

    expect(rpc).toHaveBeenCalledWith("record_contact_touch", expect.objectContaining({ p_workspace_id: "ws-1", p_contact_id: "ct-1" }));
  });

  it("la importación anota UN toque por contacto nuevo", async () => {
    const { client, rpc } = fakeDb();

    await recordImportTouches(client, { workspaceId: "ws-1", importId: "imp-1", contactIds: ["a", "b", "c"] });

    expect(rpc).toHaveBeenCalledTimes(3);
    const keys = rpc.mock.calls.map((c) => ((c as unknown[])[1] as { p_touch: { dedupe_key: string } }).p_touch.dedupe_key);
    expect(keys).toEqual(["import:imp-1:a", "import:imp-1:b", "import:imp-1:c"]);
  });

  it("una tanda grande no los manda todos a la vez: de a diez", async () => {
    let enVuelo = 0;
    let maximo = 0;
    const rpc = vi.fn(async () => {
      enVuelo += 1;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((resolve) => setTimeout(resolve, 1));
      enVuelo -= 1;
      return { data: { inserted: true }, error: null };
    });
    const ids = Array.from({ length: 35 }, (_, i) => `c-${i}`);

    await recordImportTouches({ rpc } as never, { workspaceId: "ws-1", importId: "imp-1", contactIds: ids });

    expect(rpc).toHaveBeenCalledTimes(35);
    expect(maximo).toBeLessThanOrEqual(10);
  });

  it("sin contactos nuevos no hace ningún viaje", async () => {
    const { client, rpc } = fakeDb();

    await recordImportTouches(client, { workspaceId: "ws-1", importId: "imp-1", contactIds: [] });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("NUNCA lanza: si la base explota, ni el alta ni la importación se enteran", async () => {
    const boom = fakeDb(() => {
      throw new Error("la base se cayo");
    });

    await expect(recordManualTouch(boom.client, { workspaceId: "ws-1", contactId: "ct-1", tracking: null })).resolves.toBeUndefined();
    await expect(
      recordImportTouches(boom.client, { workspaceId: "ws-1", importId: "imp-1", contactIds: ["a", "b"] }),
    ).resolves.toBeUndefined();
  });
});
