/**
 * F29: vincular, ignorar y quitar a mano. La base se simula: lo que se prueba es el contrato de la accion
 * (permiso, workspace de la sesion, visibilidad del contacto, el historial); la funcion SQL se prueba contra la
 * base real en scripts/verify-ads-attribution.mjs.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const WS = "ws-1";
let allowed = true;
let touchRows: Array<{ id: string; contact_id: string; workspace_id: string }> = [];
let visibleContacts = new Set<string>();
const rpc = vi.fn();
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: async (args: Record<string, unknown>) => void audits.push(args) }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    allowed && key === "settings.general"
      ? {
          workspace: { id: WS },
          user: { id: "u-1" },
          // El cliente de la SESION: la RLS de contacts decide que contactos ve quien vincula.
          supabase: {
            from: () => ({
              select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: visibleContacts.has(id) ? { id } : null }) }) }),
            }),
          },
        }
      : null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (_c1: string, id: string) => ({
          eq: (_c2: string, ws: string) => ({ maybeSingle: async () => ({ data: touchRows.find((t) => t.id === id && t.workspace_id === ws) ?? null }) }),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

const { linkTouchToMeta, ignoreTouchMeta, unlinkTouchMeta } = await import("./meta-match");

const OK = { data: { ok: true, before: { status: "unmatched" }, after: { status: "manual", ad_id: "3002" } }, error: null };

beforeEach(() => {
  allowed = true;
  touchRows = [{ id: "t-1", contact_id: "c-1", workspace_id: WS }, { id: "t-otro", contact_id: "c-9", workspace_id: "ws-otro" }];
  visibleContacts = new Set(["c-1", "c-9"]);
  rpc.mockReset();
  rpc.mockResolvedValue(OK);
  audits.length = 0;
});

describe("linkTouchToMeta", () => {
  it("vincula con el workspace de la SESION, deja el historial con el antes y el despues", async () => {
    const r = await linkTouchToMeta({ touchId: "t-1", adId: "3002" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_touch_meta_match", {
      p_workspace_id: WS, p_touch_id: "t-1", p_action: "link", p_user_id: "u-1", p_ad_id: "3002", p_adset_id: undefined, p_campaign_id: undefined,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workspaceId: WS, entityType: "contact", entityId: "c-1", action: "attribution.meta_linked", performedBy: "u-1",
      changes: { meta_match: { old: { status: "unmatched" }, new: { status: "manual", ad_id: "3002" } } },
      metadata: { touch_id: "t-1" },
    });
  });

  it("sin el permiso settings.general se RECHAZA y no escribe nada", async () => {
    allowed = false;
    const r = await linkTouchToMeta({ touchId: "t-1", adId: "3002" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("un toque de otro workspace no se encuentra (el workspace sale de la sesion, no del pedido)", async () => {
    const r = await linkTouchToMeta({ touchId: "t-otro", adId: "3002" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("No encontré ese toque") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si el contacto es de alguien que quien vincula no ve, se RECHAZA", async () => {
    visibleContacts.delete("c-1");
    const r = await linkTouchToMeta({ touchId: "t-1", adId: "3002" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("No tenés acceso a ese contacto") });
    expect(rpc).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("un error de la funcion (no esta en el catalogo) vuelve en palabras y no deja historial", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "not_in_catalog" }, error: null });
    const r = await linkTouchToMeta({ touchId: "t-1", adId: "no-existe" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("no está en el catálogo") });
    expect(audits).toHaveLength(0);
  });

  it("un fallo de la base vuelve como error, sin lanzar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await linkTouchToMeta({ touchId: "t-1", adId: "3002" });
    expect(r.ok).toBe(false);
    expect(audits).toHaveLength(0);
  });
});

describe("ignoreTouchMeta / unlinkTouchMeta", () => {
  it("ignorar y quitar usan la misma puerta y su propia accion de historial", async () => {
    expect(await ignoreTouchMeta("t-1")).toEqual({ ok: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_action: "ignore" });
    expect(audits[0]).toMatchObject({ action: "attribution.meta_ignored" });

    expect(await unlinkTouchMeta("t-1")).toEqual({ ok: true });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_action: "unlink" });
    expect(audits[1]).toMatchObject({ action: "attribution.meta_unlinked" });
  });

  it("sin permiso tampoco ignora ni quita", async () => {
    allowed = false;
    expect((await ignoreTouchMeta("t-1")).ok).toBe(false);
    expect((await unlinkTouchMeta("t-1")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
