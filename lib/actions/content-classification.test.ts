/**
 * F91: la clasificacion de ideas y piezas pasa por las acciones.
 *
 * Que el pilar y la oferta sean de este negocio y esten vigentes, que una pieza
 * vinculada a una idea herede su clasificacion sin pisar lo elegido a mano, y
 * que guardar el borrador solo escriba lo que viene.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const USER = "user-1";

let db: MemoryDb;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role: "admin",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const { createIdea, updateIdea, createPost, savePostDraft } = await import("./content");

beforeEach(() => {
  db = memoryDb({
    content_pillars: [
      { id: "p-ok", workspace_id: WS, name: "Educativo", archived_at: null },
      { id: "p-otro", workspace_id: WS, name: "Autoridad", archived_at: null },
      { id: "p-arch", workspace_id: WS, name: "Viejo", archived_at: "2026-10-01T00:00:00Z" },
      { id: "p-ajeno", workspace_id: "otro-ws", name: "Ajeno", archived_at: null },
    ],
    content_offers: [
      { id: "o-ok", workspace_id: WS, name: "Mentoria", archived_at: null },
      { id: "o-arch", workspace_id: WS, name: "Vieja", archived_at: "2026-10-01T00:00:00Z" },
    ],
    content_ideas: [
      {
        id: "idea-1",
        workspace_id: WS,
        title: "Una idea",
        status: "nueva",
        format: "Reel",
        reference: "https://ref.test",
        pillar_id: "p-ok",
        offer_id: "o-ok",
        funnel_stage: "mofu",
      },
      { id: "idea-vieja", workspace_id: WS, title: "Con pilar archivado", status: "nueva", pillar_id: "p-arch" },
    ],
    content_posts: [
      { id: "post-1", workspace_id: WS, title: "Una pieza", status: "draft", pillar_id: "p-arch", offer_id: null, updated_at: "2026-10-01T00:00:00Z" },
    ],
    social_posts: [],
    workspace_roles: [],
  });
});

describe("crear una idea con clasificacion", () => {
  it("escribe plataformas, oferta, pilar, etapa y referencia", async () => {
    const r = await createIdea({
      title: "Nueva",
      content: "Texto",
      platforms: ["instagram", "tiktok", "facebook"],
      pillar_id: "p-ok",
      offer_id: "o-ok",
      funnel_stage: "bofu",
      reference: "https://x.test",
    });

    expect(r.ok).toBe(true);
    const fila = db.rows("content_ideas").find((i) => i.title === "Nueva")!;
    expect(fila).toMatchObject({
      platforms: ["instagram", "tiktok"],
      pillar_id: "p-ok",
      offer_id: "o-ok",
      funnel_stage: "bofu",
      reference: "https://x.test",
      content: "Texto",
    });
  });

  it("rechaza un pilar de otro workspace y no crea la idea", async () => {
    const antes = db.rows("content_ideas").length;
    const r = await createIdea({ title: "Colada", pillar_id: "p-ajeno" });

    expect(r.ok).toBe(false);
    expect(db.rows("content_ideas")).toHaveLength(antes);
  });

  it("rechaza elegir un pilar archivado", async () => {
    expect((await createIdea({ title: "x", pillar_id: "p-arch" })).ok).toBe(false);
    expect((await createIdea({ title: "x", offer_id: "o-arch" })).ok).toBe(false);
  });

  it("sin clasificar se crea igual", async () => {
    expect((await createIdea({ title: "Pelada" })).ok).toBe(true);
  });
});

describe("editar una idea", () => {
  it("cambia el pilar a otro vigente", async () => {
    const r = await updateIdea("idea-1", { title: "Una idea", pillar_id: "p-otro" });

    expect(r.ok).toBe(true);
    expect(db.rows("content_ideas")[0].pillar_id).toBe("p-otro");
  });

  it("conserva un pilar que se archivo despues de elegirlo", async () => {
    const r = await updateIdea("idea-vieja", { title: "Con pilar archivado", content: "Edite el texto", pillar_id: "p-arch" });

    expect(r.ok).toBe(true);
    const fila = db.rows("content_ideas").find((i) => i.id === "idea-vieja")!;
    expect(fila.pillar_id).toBe("p-arch");
    expect(fila.content).toBe("Edite el texto");
  });

  it("pero no deja ELEGIR otro archivado", async () => {
    expect((await updateIdea("idea-1", { title: "x", offer_id: "o-arch" })).ok).toBe(false);
    expect(db.rows("content_ideas")[0].offer_id).toBe("o-ok");
  });

  it("sacar el pilar lo deja en null", async () => {
    await updateIdea("idea-1", { title: "Una idea", pillar_id: null });

    expect(db.rows("content_ideas")[0].pillar_id).toBeNull();
  });
});

describe("crear una pieza vinculada a una idea hereda su clasificacion", () => {
  it("formato, oferta, pilar, etapa y referencia", async () => {
    const r = await createPost({ title: "Pieza", ideaId: "idea-1", platforms: ["instagram"] });

    expect(r.ok).toBe(true);
    const fila = db.rows("content_posts").find((p) => p.title === "Pieza")!;
    expect(fila).toMatchObject({
      idea_id: "idea-1",
      format: "Reel",
      offer_id: "o-ok",
      pillar_id: "p-ok",
      funnel_stage: "mofu",
      reference: "https://ref.test",
    });
    // Las redes las elige quien crea la pieza, no la idea.
    expect((fila.networks as Array<{ platform: string }>).map((n) => n.platform)).toEqual(["instagram"]);
  });

  it("lo elegido a mano gana sobre la idea", async () => {
    await createPost({ title: "Pieza", ideaId: "idea-1", format: "Carrusel", pillar_id: "p-otro" });

    const fila = db.rows("content_posts").find((p) => p.title === "Pieza")!;
    expect(fila).toMatchObject({ format: "Carrusel", pillar_id: "p-otro", offer_id: "o-ok" });
  });

  it("sin idea no hereda nada", async () => {
    await createPost({ title: "Suelta" });

    const fila = db.rows("content_posts").find((p) => p.title === "Suelta")!;
    expect(fila).toMatchObject({ pillar_id: null, offer_id: null, funnel_stage: null, reference: null });
  });

  it("una idea de OTRO workspace no se hereda", async () => {
    db.rows("content_ideas").push({
      id: "idea-ajena", workspace_id: "otro-ws", title: "Ajena", status: "nueva", pillar_id: "p-ajeno", format: "Short",
    });

    await createPost({ title: "Intento", ideaId: "idea-ajena" });

    const fila = db.rows("content_posts").find((p) => p.title === "Intento")!;
    expect(fila.pillar_id).toBeNull();
    expect(fila.format).toBeNull();
  });
});

describe("guardar el borrador de una pieza", () => {
  it("escribe la clasificacion que viene", async () => {
    const r = await savePostDraft({
      postId: "post-1",
      pillar_id: "p-ok",
      offer_id: "o-ok",
      funnel_stage: "tofu",
      reference: "https://r.test",
    });

    expect(r.ok).toBe(true);
    expect(db.rows("content_posts")[0]).toMatchObject({
      pillar_id: "p-ok",
      offer_id: "o-ok",
      funnel_stage: "tofu",
      reference: "https://r.test",
    });
  });

  it("no toca lo que no viene: un autoguardado del titulo no borra el pilar", async () => {
    await savePostDraft({ postId: "post-1", title: "Nuevo titulo" });

    expect(db.rows("content_posts")[0]).toMatchObject({ title: "Nuevo titulo", pillar_id: "p-arch" });
  });

  it("conserva el pilar archivado que la pieza ya tenia", async () => {
    const r = await savePostDraft({ postId: "post-1", pillar_id: "p-arch", title: "Edicion" });

    expect(r.ok).toBe(true);
    expect(db.rows("content_posts")[0].pillar_id).toBe("p-arch");
  });

  it("rechaza un pilar de otro workspace sin guardar nada", async () => {
    const r = await savePostDraft({ postId: "post-1", pillar_id: "p-ajeno", title: "No deberia quedar" });

    expect(r.ok).toBe(false);
    expect(db.rows("content_posts")[0].title).toBe("Una pieza");
  });

  it("una etapa que no es tofu/mofu/bofu se guarda como vacia", async () => {
    await savePostDraft({ postId: "post-1", funnel_stage: "xofu" });

    expect(db.rows("content_posts")[0].funnel_stage).toBeNull();
  });
});
