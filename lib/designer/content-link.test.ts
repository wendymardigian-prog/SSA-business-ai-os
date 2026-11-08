import { describe, expect, it, vi } from "vitest";
import {
  NO_WRITE,
  describeLink,
  designFromPieceCore,
  editorHrefFromPiece,
  keepPieceFilesCore,
  loadModalData,
  loadPieceDesigns,
  pieceHref,
  syncToPieceCore,
  unlinkCore,
  useInContentCore,
  type LinkEnv,
} from "./content-link";
import { DESIGN, POST, USER, WS, docWithPages, mediaOf, networksOf, post, world } from "./testing/content-fixtures";
import type { MemoryDb, Row } from "./testing/memory-db";
import type { UseInContentInput } from "./contracts";
import { newTextElement } from "./screens/starter-docs";

const PAGES = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `design-${DESIGN}-${i + 1}`, storage_path: `${WS}/${POST}/design-${DESIGN}-${i + 1}.png`, mime_type: "image/png", kind: "image", size_bytes: 10, design_id: DESIGN, design_version: 4, design_page: i + 1 }));

const env = (db: MemoryDb, over: Partial<LinkEnv> = {}): LinkEnv => ({
  service: db.client,
  actor: { workspaceId: WS, userId: USER },
  canWritePiece: () => true,
  canUseAi: true,
  ...over,
});

const enqueue = () => vi.fn(async () => ({ queued: true }));
const ctx = { brandColor: "#336699", customStyles: [] };
const design = (db: MemoryDb) => db.rows("designs").find((d) => d.id === DESIGN)!;

/** Un negocio con un diseño SIN vincular y las piezas que haga falta. */
function unlinked(extra: Parameters<typeof world>[0] = {}): MemoryDb {
  return world({ ...extra, design: { content_post_id: null, content_network: null, ...(extra.design ?? {}) } });
}

describe("«Usar en contenido» → crear una pieza nueva (F63)", () => {
  const input = (over: Partial<Extract<UseInContentInput, { mode: "new" }>> = {}): UseInContentInput => ({
    designId: DESIGN,
    mode: "new",
    title: "Mi pieza nueva",
    networks: [{ platform: "instagram", format: "carousel" }],
    proposeCaption: false,
    ...over,
  });

  it("CRITERIO: crea la pieza en Borrador, con la red y su formato, la vincula y encola la sincronización", async () => {
    const db = unlinked();
    db.rows("content_posts").length = 0;
    const queue = enqueue();
    const out = await useInContentCore(env(db), input(), { enqueue: queue as never });

    expect(out.ok).toBe(true);
    const created = db.rows("content_posts")[0];
    // Sin estado propio: nace con el de la base (Borrador), igual que `createPost`.
    expect(created.status).toBeUndefined();
    expect(created).toMatchObject({ workspace_id: WS, title: "Mi pieza nueva", created_by: USER, position: 10, format: "Carrusel" });
    expect(created.networks).toEqual([expect.objectContaining({ platform: "instagram", format: "carousel", files: [], planned_at: null })]);
    expect(design(db)).toMatchObject({ content_post_id: created.id, content_network: "instagram" });
    expect(queue).toHaveBeenCalledWith(db.client, { designId: DESIGN, networks: [] });
    expect(out.ok && out.data).toMatchObject({ postId: created.id, href: pieceHref(created.id as string) });
  });

  it("con varias redes, la primera es la principal y las demás viajan en el pedido del job", async () => {
    const db = unlinked();
    const queue = enqueue();
    await useInContentCore(env(db), input({ networks: [{ platform: "instagram", format: "carousel" }, { platform: "linkedin", format: "pdf" }, { platform: "threads", format: "carousel" }] }), { enqueue: queue as never });

    const created = db.rows("content_posts").find((p) => p.title === "Mi pieza nueva")!;
    expect((created.networks as Array<{ platform: string; format: string }>).map((n) => [n.platform, n.format])).toEqual([["instagram", "carousel"], ["linkedin", "pdf"], ["threads", "carousel"]]);
    expect(design(db).content_network).toBe("instagram");
    expect(queue).toHaveBeenCalledWith(db.client, { designId: DESIGN, networks: ["linkedin", "threads"] });
  });

  it("sin título usa el nombre del diseño, y deja el lugar al final de la columna Borrador", async () => {
    const db = unlinked();
    db.rows("content_posts")[0].status = "draft";
    db.rows("content_posts")[0].position = 40;
    await useInContentCore(env(db), input({ title: "   " }), { enqueue: enqueue() as never });

    const created = db.rows("content_posts").find((p) => p.id !== POST)!;
    expect(created.title).toBe("Carrusel de prueba");
    expect(created.position).toBe(50);
  });

  it("no acepta una red que no sirve para el diseño, repetida, vacía o de más", async () => {
    const db = unlinked();
    const run = (networks: Array<{ platform: string; format: string }>) => useInContentCore(env(db), input({ networks }), { enqueue: enqueue() as never });

    expect(await run([])).toEqual({ ok: false, error: "Elegí al menos una red." });
    expect(await run([{ platform: "instagram", format: "reel" }])).toEqual({ ok: false, error: "Una de las redes elegidas no sirve para este diseño." });
    expect(await run([{ platform: "instagram", format: "story" }])).toEqual({ ok: false, error: "Una de las redes elegidas no sirve para este diseño." });
    expect(await run([{ platform: "instagram", format: "carousel" }, { platform: "instagram", format: "image" }])).toEqual({ ok: false, error: "Elegí una sola publicación por red." });
    const six = ["instagram", "tiktok", "linkedin", "threads", "youtube", "facebook"].map((platform) => ({ platform, format: "carousel" }));
    expect((await run(six)).ok).toBe(false);
    expect(db.rows("content_posts")).toHaveLength(1);
  });

  it("un título larguísimo se rechaza", async () => {
    const db = unlinked();

    expect(await useInContentCore(env(db), input({ title: "x".repeat(201) }), { enqueue: enqueue() as never })).toEqual({ ok: false, error: "El título va de 1 a 200 caracteres." });
  });

  it("un formato de diseño que no va a redes (carta A4) no se usa en contenido", async () => {
    const db = unlinked({ format: "a4_v" });

    expect(await useInContentCore(env(db), input(), { enqueue: enqueue() as never })).toEqual({ ok: false, error: "Este formato de diseño no se publica en redes." });
  });

  it("un diseño que no existe, archivado o una pieza emitida desde una plantilla", async () => {
    expect(await useInContentCore(env(unlinked()), { ...input(), designId: "otro" })).toEqual({ ok: false, error: "No encontramos este diseño." });
    expect((await useInContentCore(env(unlinked({ design: { archived_at: "2026-11-01T00:00:00Z" } })), input())).ok).toBe(false);
    expect((await useInContentCore(env(unlinked({ design: { template_id: "t" } })), input())).ok).toBe(false);
  });

  it("un diseño de otro negocio no se ve", async () => {
    const db = unlinked();
    db.rows("designs")[0].workspace_id = "otro";

    expect(await useInContentCore(env(db), input())).toEqual({ ok: false, error: "No encontramos este diseño." });
  });

  it("«Que el copywriter proponga el caption»: con permiso de IA lo pide y le da el texto del diseño de punto de partida", async () => {
    const db = unlinked();
    db.rows("designs")[0].doc = (() => {
      const doc = docWithPages("v45", 2);
      doc.pages[0].elements = [newTextElement("v45", "title", { text: "Ordená tu semana", color: "#111111", at: { x: 50, y: 40 } })];
      return doc;
    })();
    const copy = vi.fn(async () => ({ ok: true as const, agentId: "ag" }));
    const out = await useInContentCore(env(db), input({ proposeCaption: true }), { enqueue: enqueue() as never, enqueueCopy: copy as never });

    expect(out.ok && out.data.notice).toBeUndefined();
    const created = db.rows("content_posts").find((p) => p.id !== POST)!;
    expect(copy).toHaveBeenCalledWith(db.client, { workspaceId: WS, postId: created.id });
    expect(created.script).toBe("Ordená tu semana");
  });

  it("sin permiso de IA la pieza se crea igual y lo dice", async () => {
    const db = unlinked();
    const copy = vi.fn();
    const out = await useInContentCore(env(db, { canUseAi: false }), input({ proposeCaption: true }), { enqueue: enqueue() as never, enqueueCopy: copy as never });

    expect(out.ok).toBe(true);
    expect(copy).not.toHaveBeenCalled();
    expect(out.ok && out.data.notice).toContain("permiso de contenido con IA");
    expect(db.rows("content_posts").some((p) => p.id !== POST && p.script === undefined)).toBe(true);
  });

  it("si el copywriter no puede empezar (apagado) la pieza queda creada y se explica por qué", async () => {
    const db = unlinked();
    const copy = vi.fn(async () => ({ ok: false as const, error: "El copywriter esta apagado." }));
    const out = await useInContentCore(env(db), input({ proposeCaption: true }), { enqueue: enqueue() as never, enqueueCopy: copy as never });

    expect(out.ok && out.data.notice).toContain("el copywriter no pudo empezar: El copywriter esta apagado.");
  });

  it("sin pedir el caption, no llama al copywriter", async () => {
    const copy = vi.fn();
    await useInContentCore(env(unlinked()), input(), { enqueue: enqueue() as never, enqueueCopy: copy as never });

    expect(copy).not.toHaveBeenCalled();
  });

  it("crear una pieza nueva no necesita poder escribir las demás (un Member la crea y es suya)", async () => {
    const out = await useInContentCore(env(unlinked(), { canWritePiece: () => false }), input(), { enqueue: enqueue() as never });

    expect(out.ok).toBe(true);
  });
});

describe("«Usar en contenido» → vincular a una pieza existente (F63)", () => {
  const link = (platform = "instagram"): Extract<UseInContentInput, { mode: "link" }> => ({ designId: DESIGN, mode: "link", postId: POST, platform });

  it("vincula, deja la red con el formato que cuadra y encola la sincronización", async () => {
    const db = unlinked({ pages: 4 });
    const queue = enqueue();
    const out = await useInContentCore(env(db), link(), { enqueue: queue as never });

    expect(out.ok && out.data).toMatchObject({ postId: POST, href: pieceHref(POST) });
    expect(design(db)).toMatchObject({ content_post_id: POST, content_network: "instagram" });
    expect(queue).toHaveBeenCalledWith(db.client, { designId: DESIGN });
    // La pieza no cambia de estado ni de caption.
    expect(post(db).caption).toBe("Un caption");
  });

  it("si la pieza no tiene la red, la suma con su formato (sin fecha, sin archivos)", async () => {
    const db = unlinked({ format: "sq", pages: 5, networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: [] }] });
    await useInContentCore(env(db), link("linkedin"), { enqueue: enqueue() as never });

    expect(networksOf(db)).toHaveLength(2);
    expect(networksOf(db)[1]).toMatchObject({ platform: "linkedin", format: "pdf", files: [], planned_at: null });
    expect(design(db).content_network).toBe("linkedin");
  });

  it("el formato que la red de la pieza ya tiene (y sirve) se respeta", async () => {
    const db = unlinked({ pages: 3, networks: [{ platform: "instagram", planned_at: null, format: "image", files: ["x"] }] });
    await useInContentCore(env(db), link(), { enqueue: enqueue() as never });

    expect(networksOf(db)[0]).toMatchObject({ format: "image", files: ["x"] });
  });

  it("una red sin formato de diseño (un Reel) toma el de la publicación, mientras no esté programada", async () => {
    const db = unlinked({ pages: 3, networks: [{ platform: "instagram", planned_at: null, format: "reel", files: [] }] });
    await useInContentCore(env(db), link(), { enqueue: enqueue() as never });

    expect(networksOf(db)[0].format).toBe("carousel");
  });

  it("una red programada o publicada no se retoca: el aviso lo da la sincronización", async () => {
    const db = unlinked({
      pages: 3,
      networks: [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "reel", files: ["v"] }],
      publications: [{ id: "sp", content_post_id: POST, platform: "instagram", status: "scheduled", scheduled_at: "2026-12-01T10:00:00Z", published_at: null, origin: "system", publisher: null, deleted_at: null }],
    });
    await useInContentCore(env(db), link(), { enqueue: enqueue() as never });

    expect(networksOf(db)[0]).toMatchObject({ format: "reel", files: ["v"] });
    expect(design(db).content_post_id).toBe(POST);
  });

  it("solo se vincula una pieza que la persona puede escribir", async () => {
    const db = unlinked();
    const queue = enqueue();
    const out = await useInContentCore(env(db, { canWritePiece: () => false }), link(), { enqueue: queue as never });

    expect(out).toEqual({ ok: false, error: NO_WRITE });
    expect(design(db).content_post_id).toBeNull();
    expect(queue).not.toHaveBeenCalled();
  });

  it("una pieza que no existe, archivada o de otro negocio", async () => {
    expect(await useInContentCore(env(unlinked()), { ...link(), postId: "nada" })).toEqual({ ok: false, error: "No encontramos esa pieza." });
    expect(await useInContentCore(env(unlinked()), { ...link(), postId: "nada" })).toMatchObject({ ok: false });
    const archived = unlinked();
    archived.rows("content_posts")[0].archived_at = "2026-11-01T00:00:00Z";
    expect(await useInContentCore(env(archived), link())).toEqual({ ok: false, error: "Esa pieza está archivada." });
    const other = unlinked();
    other.rows("content_posts")[0].workspace_id = "otro";
    expect(await useInContentCore(env(other), link())).toEqual({ ok: false, error: "No encontramos esa pieza." });
  });

  it("un diseño que no sirve para esa red", async () => {
    const db = unlinked({ format: "story" });

    expect(await useInContentCore(env(db), link("linkedin"), { enqueue: enqueue() as never })).toEqual({ ok: false, error: "Este diseño no sirve para esa red." });
  });

  it("si otro diseño ya usaba esa red de esa pieza, este lo reemplaza y el otro queda desvinculado (sus archivos se quedan)", async () => {
    const db = unlinked({ media: PAGES(2) });
    db.rows("designs").push({ id: "otro-diseno", workspace_id: WS, name: "Versión anterior", format: "v45", doc: docWithPages("v45", 2), rev: 1, content_post_id: POST, content_network: "instagram", archived_at: null, template_id: null });
    const out = await useInContentCore(env(db), link(), { enqueue: enqueue() as never });

    expect(out.ok && out.data.notice).toContain("«Versión anterior»");
    expect(db.rows("designs").find((d) => d.id === "otro-diseno")).toMatchObject({ content_post_id: null, content_network: null });
    expect(design(db).content_post_id).toBe(POST);
    expect(mediaOf(db)).toHaveLength(2);
    expect(db.rows("audit_log").map((a) => a.action)).toEqual(["design.content_unlinked", "design.content_linked"]);
  });

  it("deja constancia en el historial", async () => {
    const db = unlinked();
    await useInContentCore(env(db), link(), { enqueue: enqueue() as never });

    expect(db.rows("audit_log")[0]).toMatchObject({ workspace_id: WS, entity_type: "design", entity_id: DESIGN, action: "design.content_linked", performed_by: USER });
  });
});

describe("«✦ Diseñar con el Diseñador IA» desde la pieza (F62)", () => {
  const FIVE = ["Frená el scroll.", "El problema.", "La solución.", "Un ejemplo.", "Escribinos CARRUSEL."];
  const piece = (over: Row = {}): Row => ({ script: FIVE.join("\n\n"), title: "Cómo ordenar tu semana", status: "draft", created_by: USER, ...over });

  function pieceWorld(over: Row = {}): MemoryDb {
    const db = world({ networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: [] }] });
    db.tables.designs = [];
    Object.assign(db.rows("content_posts")[0], piece(over));
    db.tables.content_pillars = [{ id: "pil", workspace_id: WS, name: "Productividad" }];
    db.tables.products = [{ id: "off", workspace_id: WS, name: "Programa Ejemplo" }];
    return db;
  }

  it("CRITERIO: guion de 5 partes y red Instagram Carrusel → diseño v45 vinculado, con las 5 partes en el pedido", async () => {
    const db = pieceWorld({ pillar_id: "pil", offer_id: "off", funnel_stage: "mofu", caption: "Un caption" });
    const startAi = vi.fn(async () => ({ ok: true as const, data: {} }));
    const out = await designFromPieceCore(env(db), ctx, { postId: POST, platform: "instagram" }, { startAi: startAi as never });

    expect(out.ok).toBe(true);
    const created = db.rows("designs")[0];
    expect(created).toMatchObject({ workspace_id: WS, format: "v45", origin: "ai", content_post_id: POST, content_network: "instagram" });
    expect((created.doc as { pages: unknown[] }).pages.length).toBe(1);
    // La IA recibe el pedido con las cinco partes y el contexto de la pieza.
    const asked = (startAi.mock.calls[0] as unknown as [Record<string, unknown>])[0] as { kind: string; id: string; prompt: string; multiPage: boolean; contentContext: Record<string, unknown>; attachments: unknown[]; style: unknown };
    expect(asked).toMatchObject({ kind: "design", id: created.id, multiPage: true, style: null, attachments: [] });
    for (const [i, part] of FIVE.entries()) expect(asked.prompt).toContain(`Página ${i + 1}: ${part}`);
    expect(asked.contentContext).toMatchObject({ postId: POST, script: FIVE, pillar: "Productividad", offer: "Programa Ejemplo", funnelStage: "Consideración", caption: "Un caption" });
    expect(out.ok && out.data).toEqual({ designId: created.id, href: editorHrefFromPiece(created.id as string) });
    expect(out.ok && out.data.href).toContain("?desde=pieza");
    expect(db.rows("audit_log").some((a) => a.action === "design.content_linked" && (a.metadata as { via: string }).via === "piece")).toBe(true);
  });

  it("si la red no está en la pieza, se suma con su formato", async () => {
    const db = pieceWorld();
    await designFromPieceCore(env(db), ctx, { postId: POST, platform: "linkedin" }, { startAi: vi.fn(async () => ({ ok: true as const, data: {} })) as never });

    expect(networksOf(db).map((n) => [n.platform, n.format])).toEqual([["instagram", "carousel"], ["linkedin", "pdf"]]);
    expect(db.rows("designs")[0]).toMatchObject({ format: "v45", content_network: "linkedin" });
  });

  it("si la IA no puede arrancar, el diseño queda creado y vinculado, y se avisa", async () => {
    const db = pieceWorld();
    const out = await designFromPieceCore(env(db), ctx, { postId: POST, platform: "instagram" }, { startAi: vi.fn(async () => ({ ok: false as const, error: "Todavía no está construido (Ola 2)." })) as never });

    expect(db.rows("designs")).toHaveLength(1);
    expect(out.ok && out.data.notice).toContain("La IA todavía no está disponible");
    const noAi = await designFromPieceCore(env(pieceWorld()), ctx, { postId: POST, platform: "instagram" }, { startAi: vi.fn(async () => ({ ok: false as const, error: "Conectá una IA en Integraciones." })) as never });
    expect(noAi.ok && noAi.data.notice).toBe("Conectá una IA en Integraciones.");
  });

  it("una red que no se arma con un diseño, una pieza ajena o una que no se puede escribir", async () => {
    const startAi = vi.fn();
    expect(await designFromPieceCore(env(pieceWorld()), ctx, { postId: POST, platform: "youtube" }, { startAi: startAi as never })).toEqual({ ok: false, error: "Esa red no se arma con un diseño. Elegí otra." });
    expect(await designFromPieceCore(env(pieceWorld()), ctx, { postId: "nada", platform: "instagram" }, { startAi: startAi as never })).toEqual({ ok: false, error: "No encontramos esa pieza." });
    expect(await designFromPieceCore(env(pieceWorld(), { canWritePiece: () => false }), ctx, { postId: POST, platform: "instagram" }, { startAi: startAi as never })).toEqual({ ok: false, error: NO_WRITE });
    expect(startAi).not.toHaveBeenCalled();
  });

  it("el diseño se crea con el negocio de la sesión, nunca con otro", async () => {
    const db = pieceWorld();
    db.rows("content_posts")[0].workspace_id = "otro-negocio";

    expect(await designFromPieceCore(env(db), ctx, { postId: POST, platform: "instagram" }, { startAi: vi.fn() as never })).toEqual({ ok: false, error: "No encontramos esa pieza." });
    expect(db.rows("designs")).toHaveLength(0);
  });
});

describe("enviar los cambios, desvincular y «Dejar como está» (F64, F66)", () => {
  const queued = (status: string) => [{ id: "sp", content_post_id: POST, platform: "instagram", status, scheduled_at: "2026-12-01T10:00:00Z", published_at: null, origin: "system", publisher: null, deleted_at: null }];
  const planned = [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: [`design-${DESIGN}-1`, `design-${DESIGN}-2`] }];

  it("una pieza en Borrador encola la sincronización", async () => {
    const db = world({ media: PAGES(2) });
    const queue = enqueue();
    const out = await syncToPieceCore(env(db), { designId: DESIGN }, { enqueue: queue as never });

    expect(out).toEqual({ ok: true, data: { queued: true, href: pieceHref(POST) } });
    expect(queue).toHaveBeenCalledWith(db.client, { designId: DESIGN });
  });

  it("una pieza programada pide confirmación y no encola nada", async () => {
    const db = world({ media: PAGES(2), networks: planned, publications: queued("scheduled") });
    const queue = enqueue();
    const out = await syncToPieceCore(env(db), { designId: DESIGN }, { enqueue: queue as never });

    expect(out).toEqual({ ok: true, data: { queued: false, needsConfirmation: true, href: pieceHref(POST) } });
    expect(queue).not.toHaveBeenCalled();
  });

  it("«Actualizar los archivos» en una pieza programada encola con force", async () => {
    const db = world({ media: PAGES(2), networks: planned, publications: queued("scheduled") });
    const queue = enqueue();
    await syncToPieceCore(env(db), { designId: DESIGN, force: true }, { enqueue: queue as never });

    expect(queue).toHaveBeenCalledWith(db.client, { designId: DESIGN, force: true });
  });

  it("una pieza ya publicada no se toca ni con force", async () => {
    const published = [{ id: "sp", content_post_id: POST, platform: "instagram", status: "published", scheduled_at: null, published_at: "2026-11-09T00:00:00Z", origin: "system", deleted_at: null }];
    const db = world({ media: PAGES(2), networks: planned, publications: published });
    const queue = enqueue();
    const out = await syncToPieceCore(env(db), { designId: DESIGN, force: true }, { enqueue: queue as never });

    expect(out).toEqual({ ok: true, data: { queued: false, published: true, href: pieceHref(POST) } });
    expect(queue).not.toHaveBeenCalled();
  });

  it("un diseño sin pieza, archivado, o una pieza que no se puede escribir", async () => {
    expect(await syncToPieceCore(env(unlinked()), { designId: DESIGN })).toEqual({ ok: false, error: "Este diseño no está vinculado a una pieza." });
    expect((await syncToPieceCore(env(world({ design: { archived_at: "2026-11-01T00:00:00Z" } })), { designId: DESIGN })).ok).toBe(false);
    expect(await syncToPieceCore(env(world(), { canWritePiece: () => false }), { designId: DESIGN })).toEqual({ ok: false, error: NO_WRITE });
    expect(await syncToPieceCore(env(world()), { designId: "otro" })).toEqual({ ok: false, error: "No encontramos este diseño." });
  });

  it("CRITERIO (F66): desvincular NO borra ningún archivo de la pieza ni toca sus redes", async () => {
    const db = world({ media: PAGES(3), networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: PAGES(3).map((m) => m.id) }] });
    const mediaBefore = JSON.stringify(mediaOf(db));
    const networksBefore = JSON.stringify(networksOf(db));
    db.put("content-media", `${WS}/${POST}/design-${DESIGN}-1.png`);
    const out = await unlinkCore(env(db), { designId: DESIGN });

    expect(out.ok).toBe(true);
    expect(design(db)).toMatchObject({ content_post_id: null, content_network: null });
    expect(JSON.stringify(mediaOf(db))).toBe(mediaBefore);
    expect(JSON.stringify(networksOf(db))).toBe(networksBefore);
    expect(db.paths("content-media")).toEqual([`${WS}/${POST}/design-${DESIGN}-1.png`]);
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "design.content_unlinked", performed_by: USER });
  });

  it("desvincular lo que ya está desvinculado no hace nada y no falla", async () => {
    const db = unlinked();

    expect(await unlinkCore(env(db), { designId: DESIGN })).toEqual({ ok: true, data: undefined });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("desvincular una pieza que no se puede escribir se rechaza; si la pieza ya no existe, se puede", async () => {
    expect(await unlinkCore(env(world(), { canWritePiece: () => false }), { designId: DESIGN })).toEqual({ ok: false, error: NO_WRITE });
    const gone = world();
    gone.tables.content_posts = [];
    expect((await unlinkCore(env(gone), { designId: DESIGN })).ok).toBe(true);
  });

  it("«Dejar como está»: los archivos pasan a ser de la versión actual y nada más cambia", async () => {
    const db = world({ rev: 9, media: [...PAGES(2), { id: "manual", storage_path: `${WS}/${POST}/manual.jpg`, mime_type: "image/jpeg", kind: "image", size_bytes: 1 }], networks: planned });
    const filesBefore = JSON.stringify(networksOf(db));
    const out = await keepPieceFilesCore(env(db), { designId: DESIGN });

    expect(out.ok).toBe(true);
    expect(mediaOf(db).map((m) => m.design_version)).toEqual([9, 9, undefined]);
    expect(JSON.stringify(networksOf(db))).toBe(filesBefore);
    expect(mediaOf(db).map((m) => m.id)).toEqual([`design-${DESIGN}-1`, `design-${DESIGN}-2`, "manual"]);
  });

  it("«Dejar como está» solo para quien puede escribir la pieza", async () => {
    expect(await keepPieceFilesCore(env(world({ rev: 9, media: PAGES(1) }), { canWritePiece: () => false }), { designId: DESIGN })).toEqual({ ok: false, error: NO_WRITE });
  });
});

describe("lo que leen el modal y el menú", () => {
  it("describeLink: la pieza, su estado y sus redes con el estado de cada una", async () => {
    const db = world({
      postStatus: "scheduled",
      networks: [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: [] }, { platform: "linkedin", planned_at: null, format: "pdf", files: [] }],
      publications: [{ id: "sp", content_post_id: POST, platform: "instagram", status: "scheduled", scheduled_at: "2026-12-01T10:00:00Z", published_at: null, origin: "system", deleted_at: null }],
    });
    const info = await describeLink(env(db), DESIGN);

    expect(info).toMatchObject({ postId: POST, title: "Una pieza", statusLabel: "Programado", href: pieceHref(POST), network: "instagram" });
    expect(info!.networks).toEqual([
      { platform: "instagram", label: "Instagram Carrusel", state: "sched", stateLabel: "Programado" },
      { platform: "linkedin", label: "LinkedIn Carrusel PDF", state: "none", stateLabel: "Sin fecha" },
    ]);
  });

  it("describeLink: sin vínculo, o con una pieza que ya no existe, es null", async () => {
    expect(await describeLink(env(unlinked()), DESIGN)).toBeNull();
    const gone = world();
    gone.tables.content_posts = [];
    expect(await describeLink(env(gone), DESIGN)).toBeNull();
  });

  it("loadModalData: las publicaciones donde sirve el diseño, con el aviso de páginas y la nota de TikTok", async () => {
    const db = unlinked({ format: "story", pages: 3 });
    const out = await loadModalData(env(db), DESIGN);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data).toMatchObject({ designName: "Carrusel de prueba", format: "story", pageCount: 3, canCopy: true, linked: null });
    expect(out.data.networks.map((n) => n.label)).toEqual(["Instagram · Historia", "TikTok · Carrusel de fotos"]);
    expect(out.data.networks[0].fit.level).toBe("warn");
    expect(out.data.networks[1].note).toContain("35 fotos");
  });

  it("loadModalData: dice si la persona puede pedir el caption y, si ya está vinculado, a qué pieza", async () => {
    const out = await loadModalData(env(world(), { canUseAi: false }), DESIGN);

    expect(out.ok && out.data.canCopy).toBe(false);
    expect(out.ok && out.data.linked?.postId).toBe(POST);
    expect(await loadModalData(env(world()), "otro")).toEqual({ ok: false, error: "No encontramos este diseño." });
  });

  it("loadPieceDesigns: los vinculados a la pieza y los de sus archivos, sin repetir", async () => {
    const db = world({ media: [...PAGES(2), { id: "viejo-1", storage_path: `${WS}/${POST}/viejo-1.png`, mime_type: "image/png", kind: "image", size_bytes: 1, design_id: "d-viejo", design_page: 1, design_version: 1 }] });
    db.rows("designs").push({ id: "d-viejo", workspace_id: WS, name: "Anterior", rev: 2, content_post_id: null, content_network: null, archived_at: null });
    db.rows("designs").push({ id: "d-ajeno", workspace_id: "otro", name: "Ajeno", rev: 1, content_post_id: POST, content_network: "instagram", archived_at: null });
    const rows = await loadPieceDesigns(db.client, { workspaceId: WS, postId: POST, media: mediaOf(db) as never });

    expect(rows.map((r) => r.id).sort()).toEqual([DESIGN, "d-viejo"].sort());
    expect(rows.find((r) => r.id === "d-viejo")).toMatchObject({ name: "Anterior", content_post_id: null });
  });
});
