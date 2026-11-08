/**
 * Las Server Actions del vínculo con Contenido (DS8): el permiso, el negocio de la sesión y que nunca lanzan.
 * La lógica de cada una se prueba en `lib/designer/content-link.test.ts`; acá solo el cableado.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/designer/testing/memory-db";
import { DESIGN, POST, USER, WS, world } from "@/lib/designer/testing/content-fixtures";

const state: { keys: string[]; role: string; db: MemoryDb; sessionDb: MemoryDb } = { keys: [], role: "member", db: world(), sessionDb: world() };
const startAi = vi.fn(async () => ({ ok: true as const, data: { threadId: "t", messageId: "m" } }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db.client }));
vi.mock("@/lib/actions/designer/ai", () => ({ startAiDesign: (input: unknown) => startAi(input as never) }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionContext: async () => ({
    workspace: { id: WS, design_settings: {}, name: "Academia Ejemplo", brand_name: null, brand_color: null },
    user: { id: USER },
    role: state.role,
    supabase: state.sessionDb.client,
    can: (key: string) => state.keys.includes(key),
  }),
  getPermissionAction: async (key: string) => (state.keys.includes(key) ? { workspace: { id: WS }, user: { id: USER }, can: (k: string) => state.keys.includes(k), role: state.role, supabase: state.sessionDb.client } : null),
}));

const actions = await import("./content");

const MEMBER = ["designer.view", "designer.edit", "content.create", "content.view"];

beforeEach(() => {
  state.keys = [...MEMBER];
  state.role = "member";
  state.db = world();
  state.sessionDb = world();
  startAi.mockClear();
});

const NEW_INPUT = { designId: DESIGN, mode: "new" as const, title: "Una pieza", networks: [{ platform: "instagram", format: "carousel" }], proposeCaption: false };

describe("sin los dos permisos no se puede nada (designer.edit y content.create)", () => {
  for (const missing of ["designer.edit", "content.create"]) {
    it(`sin ${missing}`, async () => {
      state.keys = MEMBER.filter((k) => k !== missing);

      for (const result of [
        await actions.useInContent(NEW_INPUT),
        await actions.designFromPiece({ postId: POST, platform: "instagram" }),
        await actions.syncToPiece({ designId: DESIGN }),
        await actions.unlinkFromPiece({ designId: DESIGN }),
        await actions.keepPieceFiles({ designId: DESIGN }),
        await actions.loadUseInContent({ designId: DESIGN }),
        await actions.searchPieces({}),
      ]) {
        expect(result).toEqual({ ok: false, error: "No tenés permiso para usar diseños en contenido." });
      }
      // No tocó nada.
      expect(state.db.rows("content_posts")).toHaveLength(1);
      expect(state.db.rows("audit_log")).toHaveLength(0);
    });
  }

  it("el Member de sistema tiene las dos y puede", async () => {
    state.db = world({ design: { content_post_id: null, content_network: null } });
    const out = await actions.useInContent(NEW_INPUT);

    expect(out.ok).toBe(true);
  });
});

describe("el negocio y la persona salen de la sesión", () => {
  it("crea la pieza en el negocio de la sesión y a nombre de quien está logueada", async () => {
    state.db = world({ design: { content_post_id: null, content_network: null } });
    await actions.useInContent(NEW_INPUT);

    const created = state.db.rows("content_posts").find((p) => p.id !== POST)!;
    expect(created.workspace_id).toBe(WS);
    expect(created.created_by).toBe(USER);
  });

  it("un diseño de otro negocio no se ve aunque el navegador mande su id", async () => {
    state.db = world({ design: { content_post_id: null, content_network: null } });
    state.db.rows("designs")[0].workspace_id = "otro-negocio";

    expect(await actions.useInContent(NEW_INPUT)).toEqual({ ok: false, error: "No encontramos este diseño." });
    expect(await actions.syncToPiece({ designId: DESIGN })).toEqual({ ok: false, error: "No encontramos este diseño." });
  });
});

describe("un Member solo toca las piezas que puede escribir", () => {
  it("vincular una pieza ajena se rechaza; una propia, no", async () => {
    state.db = world({ design: { content_post_id: null, content_network: null } });
    state.db.rows("content_posts")[0].created_by = "otra-persona";
    const link = { designId: DESIGN, mode: "link" as const, postId: POST, platform: "instagram" };

    expect((await actions.useInContent(link)).ok).toBe(false);
    expect(state.db.rows("designs")[0].content_post_id).toBeNull();

    state.db.rows("content_posts")[0].created_by = USER;
    expect((await actions.useInContent(link)).ok).toBe(true);
    expect(state.db.rows("designs")[0].content_post_id).toBe(POST);
  });

  it("la responsable de la pieza la puede escribir; un administrador, cualquiera", async () => {
    state.db = world({ design: { content_post_id: null, content_network: null } });
    state.db.rows("content_posts")[0].created_by = "otra-persona";
    state.db.rows("content_posts")[0].assigned_to = USER;
    expect((await actions.useInContent({ designId: DESIGN, mode: "link", postId: POST, platform: "instagram" })).ok).toBe(true);

    state.role = "admin";
    state.db = world({ design: { content_post_id: null, content_network: null } });
    state.db.rows("content_posts")[0].created_by = "otra-persona";
    expect((await actions.useInContent({ designId: DESIGN, mode: "link", postId: POST, platform: "instagram" })).ok).toBe(true);
  });
});

describe("designFromPiece y el resto", () => {
  it("diseñar desde la pieza llama a la IA con el pedido de la pieza", async () => {
    state.db = world({ networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: [] }] });
    state.db.tables.designs = [];
    state.db.rows("content_posts")[0].created_by = USER;
    state.db.rows("content_posts")[0].script = "Uno\n\nDos\n\nTres";
    const out = await actions.designFromPiece({ postId: POST, platform: "instagram" });

    expect(out.ok).toBe(true);
    expect(startAi).toHaveBeenCalledTimes(1);
    const asked = (startAi.mock.calls[0] as unknown as [{ prompt: string; contentContext: { script: string[] } }])[0];
    expect(asked.contentContext.script).toEqual(["Uno", "Dos", "Tres"]);
    expect(asked.prompt).toContain("Página 3: Tres");
  });

  it("enviar los cambios, desvincular y «Dejar como está» andan con el permiso", async () => {
    state.db = world();
    state.db.rows("content_posts")[0].created_by = USER;

    expect((await actions.keepPieceFiles({ designId: DESIGN })).ok).toBe(true);
    expect((await actions.unlinkFromPiece({ designId: DESIGN })).ok).toBe(true);
    expect(state.db.rows("designs")[0].content_post_id).toBeNull();
  });

  it("el modal lee las publicaciones del diseño", async () => {
    const out = await actions.loadUseInContent({ designId: DESIGN });

    expect(out.ok && out.data.networks.length).toBeGreaterThan(0);
  });

  it("el menú «En contenido» se lee con el permiso de ver (sin él, no se lee)", async () => {
    state.keys = [];

    expect(await actions.loadContentLink({ designId: DESIGN })).toEqual({ ok: false, error: "No tenés permiso para ver diseños." });
    state.keys = ["designer.view"];
    const out = await actions.loadContentLink({ designId: DESIGN });
    expect(out.ok && out.data?.postId).toBe(POST);
  });

  it("el buscador ofrece solo las piezas que la persona puede escribir", async () => {
    state.sessionDb = world();
    const rows = state.sessionDb.rows("content_posts");
    rows[0].created_by = USER;
    rows.push({ ...rows[0], id: "ajena", created_by: "otra" });
    const out = await actions.searchPieces({});

    expect(out.ok && out.data.map((p) => p.id)).toEqual([POST]);
  });

  it("nunca lanza: si la base falla, devuelve un error claro", async () => {
    state.db = {
      from() {
        throw new Error("caída de la base");
      },
      get client() {
        return this;
      },
    } as unknown as MemoryDb;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await actions.useInContent(NEW_INPUT);
    spy.mockRestore();

    expect(out).toEqual({ ok: false, error: "No pude hacerlo ahora. Probá de nuevo." });
  });
});
