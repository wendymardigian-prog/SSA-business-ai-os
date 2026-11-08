/**
 * Lo que NO cambia en Contenido (DS8, F66): publicar, programar, el borrado de media publicada a los 30 días y los
 * permisos de Contenido son los de siempre. Vincular y sincronizar un diseño solo agrega una pieza o una red, y escribe la
 * biblioteca y los archivos de una red; nunca toca lo que publica. Desvincular o archivar un diseño no borra archivos.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_KEYS, MEMBER_PERMISSION_KEYS } from "@/lib/auth/permissions";
import { planCleanup } from "@/lib/content/cleanup";
import type { MediaEntry } from "@/lib/content/media";
import { removalPlan } from "@/lib/content/media";
import { unlinkCore } from "./content-link";
import { runContentSync } from "./jobs/content-sync";
import { DESIGN, NOW, POST, WS, USER, docWithPages, mediaOf, networksOf, post, world } from "./testing/content-fixtures";
import type { MemoryDb } from "./testing/memory-db";
import type { RenderRequest } from "./render-client";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Los archivos de DS8 que escriben en la base o llaman a otros módulos. */
const DS8_SERVER_FILES = ["lib/designer/content-sync.ts", "lib/designer/content-link.ts", "lib/designer/content-state.ts", "lib/designer/jobs/content-sync.ts", "lib/actions/designer/content.ts"];

describe("DS8 no toca lo que publica ni lo que programa", () => {
  it("ningún archivo de DS8 importa el despachador, programar, revisar o los publicadores", () => {
    for (const file of DS8_SERVER_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/from "@\/lib\/publishing\/(dispatcher|bootstrap|zernio|schedule|reschedule|publish)/);
      expect(source, file).not.toContain("lib/actions/content-schedule");
      expect(source, file).not.toContain("lib/actions/content-review");
      expect(source, file).not.toContain("scheduleNetworks");
      expect(source, file).not.toContain("publishPost");
    }
  });

  it("lo único que usan de la publicación es validar y reenviar lo ya agendado (lo mismo que agregar o sacar un archivo)", () => {
    const imports = DS8_SERVER_FILES.flatMap((file) => [...read(file).matchAll(/from "(@\/lib\/publishing\/[^"]+)"/g)].map((m) => m[1]));

    expect([...new Set(imports)]).toEqual(["@/lib/publishing/content-resync"]);
  });

  it("no escriben `social_posts` ni cambian el estado de la pieza ni borran piezas o ideas", () => {
    for (const file of DS8_SERVER_FILES) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\("social_posts"\)\s*\.\s*(insert|update|delete|upsert)/);
      expect(source, file).not.toMatch(/from\("content_(posts|ideas)"\)\s*\.\s*delete/);
      expect(source, file).not.toMatch(/\.update\(\{[^}]*\bstatus\b/);
    }
  });

  it("al sincronizar solo se escribe `media` y `networks` de la pieza: nunca su estado, su caption ni sus publicaciones", async () => {
    const db = world({
      pages: 3,
      networks: [
        { platform: "instagram", planned_at: null, format: "carousel", files: [] },
        { platform: "linkedin", planned_at: null, format: "pdf", files: [] },
      ],
      accounts: [],
    });
    const render = vi.fn(async (req: RenderRequest) => ({
      version: "t",
      files: req.format === "pdf" ? [{ page: 0, contentType: "application/pdf" as const, bytes: new Uint8Array([37, 80, 68, 70, 45, 49]) }] : (req.pages ?? []).map((_, page) => ({ page, contentType: "image/png" as const, bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]) })),
    }));
    await runContentSync(db.client, { designId: DESIGN, networks: ["linkedin"] }, { render, now: () => NOW, schedule: vi.fn() as never });

    const writes = db.log.filter((entry) => entry.op !== "insert" || entry.table !== "audit_log");
    expect([...new Set(writes.map((w) => w.table))]).toEqual(["content_posts"]);
    for (const write of writes) expect(Object.keys(write.values[0]).sort()).toEqual(["media", "networks"]);
    expect(post(db)).toMatchObject({ status: "draft", caption: "Un caption", title: "Una pieza" });
    expect(db.rows("social_posts")).toEqual([]);
  });

  it("una pieza programada o publicada no cambia ni un campo cuando el diseño cambia", async () => {
    for (const status of ["scheduled", "published"]) {
      const db = world({
        pages: 3,
        rev: 9,
        postStatus: status,
        networks: [{ platform: "instagram", planned_at: "2026-12-01T10:00:00Z", format: "carousel", files: ["x-1", "x-2"] }],
        publications: [{ id: "sp", content_post_id: POST, platform: "instagram", status, scheduled_at: "2026-12-01T10:00:00Z", published_at: status === "published" ? "2026-11-09T00:00:00Z" : null, origin: "system", publisher: null, deleted_at: null }],
      });
      const before = JSON.stringify([post(db), db.rows("social_posts")]);
      const render = vi.fn();
      await runContentSync(db.client, { designId: DESIGN }, { render: render as never, now: () => NOW, schedule: vi.fn() as never });

      expect(JSON.stringify([post(db), db.rows("social_posts")]), status).toBe(before);
      expect(render).not.toHaveBeenCalled();
      expect(db.log).toEqual([]);
    }
  });
});

describe("desvincular o archivar un diseño NO borra archivos de la pieza", () => {
  const files = [1, 2, 3].map((n) => ({ id: `design-${DESIGN}-${n}`, storage_path: `${WS}/${POST}/design-${DESIGN}-${n}.png`, mime_type: "image/png", kind: "image", size_bytes: 10, design_id: DESIGN, design_version: 4, design_page: n }));

  function seeded(extra: Record<string, unknown> = {}): MemoryDb {
    const db = world({ media: files, networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: files.map((f) => f.id) }], design: extra });
    for (const f of files) db.put("content-media", f.storage_path);
    return db;
  }

  it("desvincular deja la biblioteca, las redes y el bucket exactamente como estaban", async () => {
    const db = seeded();
    const before = JSON.stringify([mediaOf(db), networksOf(db)]);
    const env = { service: db.client, actor: { workspaceId: WS, userId: USER }, canWritePiece: () => true, canUseAi: true };
    await unlinkCore(env, { designId: DESIGN });

    expect(JSON.stringify([mediaOf(db), networksOf(db)])).toBe(before);
    expect(db.paths("content-media")).toHaveLength(3);
    expect(db.log.some((l) => l.op === "delete")).toBe(false);
  });

  it("un diseño archivado deja de sincronizar y los archivos de la pieza se quedan", async () => {
    const db = seeded({ archived_at: "2026-11-05T00:00:00Z", rev: 12 });
    db.rows("designs")[0].doc = docWithPages("v45", 1);
    const before = JSON.stringify([mediaOf(db), networksOf(db)]);
    const out = await runContentSync(db.client, { designId: DESIGN }, { render: vi.fn() as never, now: () => NOW, schedule: vi.fn() as never });

    expect(out).toEqual({ status: "skipped", reason: "archived" });
    expect(JSON.stringify([mediaOf(db), networksOf(db)])).toBe(before);
    expect(db.paths("content-media")).toHaveLength(3);
    expect(db.log).toEqual([]);
  });

  it("un diseño desvinculado tampoco se sincroniza", async () => {
    const db = seeded({ content_post_id: null, content_network: null });

    expect(await runContentSync(db.client, { designId: DESIGN }, { render: vi.fn() as never, now: () => NOW, schedule: vi.fn() as never })).toEqual({ status: "skipped", reason: "not_linked" });
    expect(db.paths("content-media")).toHaveLength(3);
  });
});

describe("el borrado de media publicada a los 30 días es el de siempre", () => {
  const entry = (extra: Partial<MediaEntry> = {}): MediaEntry => ({ id: "design-d-1", storage_path: `${WS}/${POST}/design-d-1.png`, mime_type: "image/png", kind: "image", size_bytes: 10, design_id: "d", design_page: 1, ...extra });
  const published = "2026-10-01T00:00:00Z";

  it("los archivos de un diseño de una pieza publicada se limpian como cualquier otro, pasado el plazo", () => {
    const plans = planCleanup({ posts: [{ id: POST, publishedAt: published, media: [entry(), entry({ id: "foto", storage_path: `${WS}/${POST}/foto.jpg`, design_id: undefined })] }], retentionDays: 30, now: new Date("2026-11-08T00:00:00Z") });

    expect(plans).toHaveLength(1);
    expect(plans[0].paths).toEqual([`${WS}/${POST}/design-d-1.png`, `${WS}/${POST}/foto.jpg`]);
    // Queda marcado en la pieza (el historial dice que hubo un archivo) y conserva a qué diseño pertenecía.
    expect(plans[0].media[0]).toMatchObject({ design_id: "d", design_page: 1 });
    expect(plans[0].media.every((m) => typeof m.deleted_at === "string")).toBe(true);
  });

  it("dentro del plazo, o con retención 0, no se borra nada", () => {
    expect(planCleanup({ posts: [{ id: POST, publishedAt: published, media: [entry()] }], retentionDays: 30, now: new Date("2026-10-15T00:00:00Z") })).toEqual([]);
    expect(planCleanup({ posts: [{ id: POST, publishedAt: published, media: [entry()] }], retentionDays: 0, now: new Date("2027-01-01T00:00:00Z") })).toEqual([]);
  });

  it("quitar un archivo de una pieza publicada lo marca y lo conserva en el bucket (removalPlan, sin cambios)", () => {
    const plan = removalPlan({ media: [entry()], storagePath: `${WS}/${POST}/design-d-1.png`, postPublished: true });

    expect(plan.deleteFromBucket).toBe(false);
    expect(plan.media[0].deleted_at).toBeTruthy();
  });
});

describe("los permisos de Contenido son los de siempre", () => {
  it("DS8 usa claves que ya existen: designer.edit, designer.view, content.create y content.ai", () => {
    for (const key of ["designer.edit", "designer.view", "content.create", "content.ai"]) expect(ALL_PERMISSION_KEYS).toContain(key);
    const source = read("lib/actions/designer/content.ts");
    for (const key of [...source.matchAll(/can\("([a-z.]+)"\)/g)].map((m) => m[1])) expect(ALL_PERMISSION_KEYS, key).toContain(key);
  });

  it("el Member de sistema tiene las dos claves que piden las acciones (designer.edit y content.create)", () => {
    expect(MEMBER_PERMISSION_KEYS).toContain("designer.edit");
    expect(MEMBER_PERMISSION_KEYS).toContain("content.create");
  });

  it("DS8 no define claves nuevas ni toca el archivo de permisos", () => {
    for (const file of DS8_SERVER_FILES) expect(read(file), file).not.toContain("PERMISSION_KEYS.push");
    const permissions = read("lib/auth/permissions.ts");
    expect(permissions).not.toMatch(/key: "design[a-z]*\.(content|link|sync)/);
  });
});
