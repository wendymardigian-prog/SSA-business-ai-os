import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultAttributionSettings } from "@/lib/attribution/settings";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
let db: MemoryDb;
let allowed = true;
const audits: Array<Record<string, unknown>> = [];
const asked: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return "a"; }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => {
    asked.push(key);
    return allowed ? { supabase: db.client, user: { id: USER }, workspace: { id: WS } } : null;
  },
}));

const { updateAttributionSettings } = await import("./attribution-settings");

const valid = () => ({
  comments_create_contact: { instagram: true, tiktok: false },
  content_inherit_days: 14,
  links_append_default: true,
  links_track_clicks_default: false,
});

beforeEach(() => {
  allowed = true;
  audits.length = 0;
  asked.length = 0;
  db = memoryDb({
    workspaces: [
      { id: WS, name: "Mío", finance_settings: { x: 1 }, attribution_settings: defaultAttributionSettings() },
      { id: OTHER_WS, name: "Ajeno", attribution_settings: defaultAttributionSettings() },
    ],
  });
});

describe("updateAttributionSettings", () => {
  it("pide settings.general y, sin el permiso, no escribe ni deja historial", async () => {
    allowed = false;
    const r = await updateAttributionSettings(valid());
    expect(r).toMatchObject({ ok: false });
    expect(asked).toEqual(["settings.general"]);
    expect(db.rows("workspaces").find((w) => w.id === WS)?.attribution_settings).toEqual(defaultAttributionSettings());
    expect(audits).toHaveLength(0);
  });

  it("rechaza días fuera de 1 a 30 con un mensaje claro y no escribe", async () => {
    for (const days of [0, 31, -3, 2.5, "7", null]) {
      const r = await updateAttributionSettings({ ...valid(), content_inherit_days: days });
      expect(r).toEqual({ ok: false, error: "Los días de herencia van de 1 a 30" });
    }
    expect(db.rows("workspaces").find((w) => w.id === WS)?.attribution_settings).toEqual(defaultAttributionSettings());
    expect(audits).toHaveLength(0);
  });

  it("rechaza lo que no tiene la forma (un interruptor que no es booleano, una red que falta)", async () => {
    expect(await updateAttributionSettings({ ...valid(), links_append_default: "si" })).toMatchObject({ ok: false });
    expect(await updateAttributionSettings({ ...valid(), comments_create_contact: { instagram: true } })).toMatchObject({ ok: false });
    expect(await updateAttributionSettings(null)).toMatchObject({ ok: false });
    expect(audits).toHaveLength(0);
  });

  it("guarda solo esa columna, del workspace de la sesión", async () => {
    const r = await updateAttributionSettings(valid());
    expect(r).toEqual({ ok: true, settings: valid() });
    const mine = db.rows("workspaces").find((w) => w.id === WS);
    expect(mine?.attribution_settings).toEqual(valid());
    expect(mine).toMatchObject({ name: "Mío", finance_settings: { x: 1 } });
    expect(db.rows("workspaces").find((w) => w.id === OTHER_WS)?.attribution_settings).toEqual(defaultAttributionSettings());
  });

  it("descarta claves de más que mande el navegador", async () => {
    const r = await updateAttributionSettings({ ...valid(), workspace_id: OTHER_WS, extra: 1 });
    expect(r).toEqual({ ok: true, settings: valid() });
    expect(db.rows("workspaces").find((w) => w.id === WS)?.attribution_settings).toEqual(valid());
  });

  it("deja historial con el antes y el después", async () => {
    await updateAttributionSettings(valid());
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workspaceId: WS,
      entityType: "workspace",
      entityId: WS,
      action: "attribution.settings_updated",
      performedBy: USER,
      changes: { attribution_settings: { old: defaultAttributionSettings(), new: valid() } },
    });
  });
});
